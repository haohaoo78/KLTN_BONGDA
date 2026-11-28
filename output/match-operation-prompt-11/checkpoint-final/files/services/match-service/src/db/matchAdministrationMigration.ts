import { Pool } from "pg";

export const matchAdministrationSql = `
 ALTER TABLE matches ADD COLUMN administration_revision INTEGER NOT NULL DEFAULT 0;
 CREATE TABLE match_administrative_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), match_id UUID NOT NULL REFERENCES matches(id),
  kind TEXT NOT NULL, description TEXT NOT NULL, evidence TEXT, reported_by UUID NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE TABLE match_administrative_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), request_id UUID NOT NULL UNIQUE,
  case_id UUID NOT NULL REFERENCES match_administrative_cases(id), match_id UUID NOT NULL REFERENCES matches(id),
  revision INTEGER NOT NULL, action TEXT NOT NULL, basis TEXT NOT NULL, reason TEXT NOT NULL,
  actor_id UUID NOT NULL, before_snapshot JSONB NOT NULL, after_snapshot JSONB NOT NULL,
  rule_snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(match_id,revision)
 );
 CREATE TABLE match_administrative_outbox (
  id BIGSERIAL PRIMARY KEY, decision_id UUID NOT NULL REFERENCES match_administrative_decisions(id),
  target TEXT NOT NULL CHECK(target IN ('SCHEDULING','NOTIFICATION')), payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ, error_code TEXT, UNIQUE(decision_id,target)
 );
 CREATE TABLE match_replay_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), match_id UUID NOT NULL REFERENCES matches(id),
  decision_id UUID NOT NULL UNIQUE REFERENCES match_administrative_decisions(id), snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE FUNCTION protect_match_administrative_history() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'Administrative decision history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_match_administrative_history BEFORE UPDATE OR DELETE ON match_administrative_decisions
  FOR EACH ROW EXECUTE FUNCTION protect_match_administrative_history();
 CREATE TRIGGER protect_match_replay_history BEFORE UPDATE OR DELETE ON match_replay_attempts
  FOR EACH ROW EXECUTE FUNCTION protect_match_administrative_history();
 CREATE INDEX ON match_administrative_cases(match_id,resolved_at);
 CREATE INDEX ON match_administrative_outbox(next_attempt_at) WHERE completed_at IS NULL;
 CREATE TABLE competition_completion_fences (
  tournament_id UUID PRIMARY KEY, request_id UUID NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','COMPLETED')), snapshot JSONB NOT NULL,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), completed_at TIMESTAMPTZ
 );
 CREATE FUNCTION guard_competition_completion() RETURNS trigger AS $$
 DECLARE tid UUID; mid UUID;
 BEGIN
  IF TG_TABLE_NAME='matches' THEN tid:=COALESCE(NEW.tournament_id,OLD.tournament_id);
  ELSE mid:=COALESCE(NEW.match_id,OLD.match_id);
   SELECT tournament_id INTO tid FROM matches WHERE id=mid FOR SHARE;
  END IF;
  IF EXISTS(SELECT 1 FROM competition_completion_fences WHERE tournament_id=tid) THEN
   RAISE EXCEPTION 'Competition completion is prepared or committed; ordinary mutation is locked' USING ERRCODE='P0010';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON matches FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_results FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_reports FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_events FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON lineups FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_squads FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_clock_states FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_administrative_cases FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_pause_requests FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_result_correction_requests FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
 CREATE TRIGGER guard_competition_completion BEFORE INSERT OR UPDATE OR DELETE ON match_forfeit_decisions FOR EACH ROW EXECUTE FUNCTION guard_competition_completion();
`;
export const schedulingAdministrationSql = `
 ALTER TABLE schedules ADD COLUMN operation_status TEXT, ADD COLUMN operation_revision INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN operation_decision_id UUID;
`;
export const disciplineAdministrationSql = `
 CREATE TABLE complaint_review_history (
  id BIGSERIAL PRIMARY KEY, complaint_id UUID NOT NULL, appeal_id UUID,
  actor_id UUID NOT NULL, before_snapshot JSONB NOT NULL, after_snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE TABLE tournament_operation_completion_fences (
  tournament_id UUID PRIMARY KEY,request_id UUID NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','COMPLETED')),snapshot JSONB NOT NULL,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),completed_at TIMESTAMPTZ
 );
 CREATE FUNCTION guard_discipline_completion_fence() RETURNS trigger AS $$
 DECLARE tid UUID;
 BEGIN
  IF TG_TABLE_NAME='complaints' THEN tid:=COALESCE(NEW.tournament_id,OLD.tournament_id);
  ELSE SELECT tournament_id INTO tid FROM complaints WHERE id=COALESCE(NEW.complaint_id,OLD.complaint_id); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(tid::text,10));
  IF EXISTS(SELECT 1 FROM tournament_operation_completion_fences WHERE tournament_id=tid) THEN
   RAISE EXCEPTION 'Tournament completion is prepared; complaint and appeal mutations are locked' USING ERRCODE='P0010';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER guard_discipline_completion BEFORE INSERT OR UPDATE OR DELETE ON complaints FOR EACH ROW EXECUTE FUNCTION guard_discipline_completion_fence();
 CREATE TRIGGER guard_discipline_completion BEFORE INSERT OR UPDATE OR DELETE ON complaint_appeals FOR EACH ROW EXECUTE FUNCTION guard_discipline_completion_fence();
 ALTER TABLE complaints ADD COLUMN deadline_snapshot JSONB;
 ALTER TABLE complaint_appeals ADD COLUMN deadline_snapshot JSONB;
 CREATE FUNCTION protect_complaint_review_history() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'Complaint review history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_complaint_review_history BEFORE UPDATE OR DELETE ON complaint_review_history
  FOR EACH ROW EXECUTE FUNCTION protect_complaint_review_history();
`;
async function apply(url: string, version: number, name: string, sql: string) {
 const pool = new Pool({ connectionString: url }), c = await pool.connect();
 try { await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)');
  if (!(await c.query('SELECT 1 FROM sfl_schema_migrations WHERE version=$1',[version])).rowCount) {
   await c.query(sql); await c.query('INSERT INTO sfl_schema_migrations(version,name) VALUES($1,$2)',[version,name]);
  }
  await c.query('COMMIT');
 } catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); await pool.end(); }
}
export const applyMatchAdministrationMigration = (url:string) => apply(url,30,'audited-match-exceptions-and-durable-administrative-delivery',matchAdministrationSql);
export const applySchedulingAdministrationMigration = (url:string) => apply(url,1014,'administrative-operation-state-without-changing-kickoff-or-venue',schedulingAdministrationSql);
export const applyDisciplineAdministrationMigration = (url:string) => apply(url,1005,'complaint-deadline-snapshots-and-review-history',disciplineAdministrationSql);

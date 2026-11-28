import { Pool } from "pg";

export const competitionProjectionSql = `
 ALTER TABLE standings ADD COLUMN group_id UUID, ADD COLUMN group_rank INTEGER, ADD COLUMN ranking_issue TEXT;
 ALTER TABLE match_group_lot_draws ADD COLUMN result_signature TEXT;
 ALTER TABLE match_group_lot_draws DROP CONSTRAINT match_group_lot_draw_unique;
 ALTER TABLE match_group_lot_draws ADD CONSTRAINT match_group_lot_draw_unique UNIQUE(draw_version_id,group_id,tie_key,result_signature);
 ALTER TABLE match_results ADD COLUMN result_origin VARCHAR(30) NOT NULL DEFAULT 'FIELD';
 CREATE TABLE competition_projection_conflicts (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tournament_id UUID NOT NULL,
   match_id UUID, conflict_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
   details JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   resolved_at TIMESTAMPTZ, resolved_by UUID, resolution TEXT
 );
 ALTER TABLE match_event_discipline_outbox DROP CONSTRAINT match_event_discipline_outbox_action_check;
 ALTER TABLE match_event_discipline_outbox ADD CONSTRAINT match_event_discipline_outbox_action_check
   CHECK(action IN ('ISSUE_CARD','VOID_CARD','RECONCILE_RESULT'));
 ALTER TABLE match_event_discipline_outbox ADD COLUMN deduplication_key TEXT UNIQUE;
`;
export const disciplineProjectionSql = `
 ALTER TABLE cards ADD COLUMN event_kind TEXT, ADD COLUMN event_phase TEXT,
   ADD COLUMN source_match_date TIMESTAMPTZ, ADD COLUMN source_stage TEXT,
   ADD COLUMN rule_snapshot JSONB;
 ALTER TABLE suspensions ALTER COLUMN end_date DROP NOT NULL;
 ALTER TABLE suspensions ADD COLUMN source_event_ids UUID[], ADD COLUMN scope_stage TEXT,
   ADD COLUMN status_reason TEXT, ADD COLUMN served_match_ids UUID[] NOT NULL DEFAULT '{}',
   ADD COLUMN rule_snapshot JSONB, ADD COLUMN projection_key TEXT UNIQUE,
   ADD COLUMN manually_lifted BOOLEAN NOT NULL DEFAULT FALSE;
 CREATE TABLE discipline_projection_history (
   id BIGSERIAL PRIMARY KEY, tournament_id UUID NOT NULL, player_id UUID NOT NULL,
   source_signature TEXT NOT NULL, snapshot JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   UNIQUE(tournament_id,player_id,source_signature)
 );
 CREATE FUNCTION protect_discipline_projection_history() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Discipline projection history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_discipline_projection_history BEFORE UPDATE OR DELETE ON discipline_projection_history FOR EACH ROW EXECUTE FUNCTION protect_discipline_projection_history();
`;
async function apply(url:string,version:number,name:string,sql:string){
 const p=new Pool({connectionString:url}),c=await p.connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)');
  if(!(await c.query('SELECT 1 FROM sfl_schema_migrations WHERE version=$1',[version])).rowCount){await c.query(sql);await c.query('INSERT INTO sfl_schema_migrations(version,name) VALUES($1,$2)',[version,name]);}
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await p.end();}
}
export const applyCompetitionProjectionMigration=(url:string)=>apply(url,29,'canonical-standings-qualification-and-result-discipline-outbox',competitionProjectionSql);
export const applyDisciplineProjectionMigration=(url:string)=>apply(url,1004,'versioned-card-policy-and-match-count-suspension-projection',disciplineProjectionSql);

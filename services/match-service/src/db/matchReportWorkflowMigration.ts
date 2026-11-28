import { Pool } from "pg";

/** Additive report preparation/retry metadata. Existing submissions remain untouched. */
export const matchReportWorkflowSql = `
 ALTER TABLE match_reports
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  ADD COLUMN draft JSONB,
  ADD COLUMN requires_organizer_review BOOLEAN NOT NULL DEFAULT TRUE;
 ALTER TABLE match_reports DROP CONSTRAINT match_reports_status_check;
 ALTER TABLE match_reports ADD CONSTRAINT match_reports_status_check
  CHECK(status IN ('DRAFT','PENDING','APPROVED','REJECTED','REVISION_REQUIRED'));
 ALTER TABLE match_report_reviews ADD COLUMN report_version INTEGER;
 CREATE TABLE match_report_operations (
  match_id UUID NOT NULL REFERENCES matches(id), actor_id UUID NOT NULL,
  operation_id UUID NOT NULL, request_hash TEXT NOT NULL, response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(match_id,actor_id,operation_id)
 );
 CREATE FUNCTION protect_match_report_history() RETURNS trigger AS $$
 BEGIN
  IF TG_TABLE_NAME='match_reports' THEN
   IF jsonb_array_length(NEW.submission_snapshots)<jsonb_array_length(OLD.submission_snapshots)
    OR (SELECT COALESCE(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb)
        FROM jsonb_array_elements(NEW.submission_snapshots) WITH ORDINALITY
        WHERE ordinality<=jsonb_array_length(OLD.submission_snapshots))<>OLD.submission_snapshots
   THEN RAISE EXCEPTION 'Report submission history is append-only'; END IF;
   RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Report operation and review history is append-only';
 END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_match_report_submissions BEFORE UPDATE ON match_reports
 FOR EACH ROW EXECUTE FUNCTION protect_match_report_history();
 CREATE TRIGGER protect_match_report_reviews BEFORE UPDATE OR DELETE ON match_report_reviews
 FOR EACH ROW EXECUTE FUNCTION protect_match_report_history();
 CREATE TRIGGER protect_match_report_operations BEFORE UPDATE OR DELETE ON match_report_operations
 FOR EACH ROW EXECUTE FUNCTION protect_match_report_history();
`;

export async function applyMatchReportWorkflowMigration(url: string) {
 const pool=new Pool({connectionString:url}), client=await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)');
  if(!(await client.query('SELECT 1 FROM sfl_schema_migrations WHERE version=28')).rowCount){
   await client.query(matchReportWorkflowSql);
   await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(28,'atomic-report-final-authority-and-submission-history')");
  }
  await client.query('COMMIT');
 } catch(error){await client.query('ROLLBACK');throw error;}
 finally{client.release();await pool.end();}
}

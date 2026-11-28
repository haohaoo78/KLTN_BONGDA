import { Pool } from "pg";

/** Additive only. This is a development clock, never a schedule or a second event store. */
export const matchDemoTimeSql = `
 CREATE TABLE match_demo_times (
  match_id UUID PRIMARY KEY REFERENCES matches(id), enabled BOOLEAN NOT NULL,
  offset_milliseconds BIGINT NOT NULL DEFAULT 0 CHECK(offset_milliseconds >= 0),
  revision INTEGER NOT NULL CHECK(revision > 0), updated_by UUID NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
 CREATE TABLE match_demo_time_history (
  id BIGSERIAL PRIMARY KEY, match_id UUID NOT NULL REFERENCES matches(id),
  revision INTEGER NOT NULL, action TEXT NOT NULL, actor_id UUID NOT NULL,
  before_state JSONB, after_state JSONB NOT NULL,
  real_time TIMESTAMPTZ NOT NULL, effective_time TIMESTAMPTZ NOT NULL,
  UNIQUE(match_id,revision)
 );
 CREATE FUNCTION protect_match_demo_time_history() RETURNS trigger AS $$
 BEGIN RAISE EXCEPTION 'Demo time history is append-only'; END; $$ LANGUAGE plpgsql;
 CREATE TRIGGER protect_match_demo_time_history BEFORE UPDATE OR DELETE ON match_demo_time_history
 FOR EACH ROW EXECUTE FUNCTION protect_match_demo_time_history();
`;

export async function applyMatchDemoTimeMigration(url: string) {
 const pool = new Pool({connectionString:url}), client = await pool.connect();
 try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
  if (!(await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=27")).rowCount) {
   await client.query(matchDemoTimeSql);
   await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(27,'development-match-scoped-time')");
  }
  await client.query("COMMIT");
 } catch(error) { await client.query("ROLLBACK"); throw error; }
 finally {client.release(); await pool.end();}
}

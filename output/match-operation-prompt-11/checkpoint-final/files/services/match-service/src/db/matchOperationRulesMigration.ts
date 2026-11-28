import { Pool } from "pg";
export const matchOperationRulesSql = `
  CREATE TABLE IF NOT EXISTS match_operation_rule_bindings (
    match_id UUID NOT NULL REFERENCES matches(id),
    revision INTEGER NOT NULL CHECK (revision>0),
    supplement_id UUID NOT NULL,
    source JSONB NOT NULL CHECK (jsonb_typeof(source)='object'),
    reason TEXT NOT NULL CHECK (length(trim(reason))>0),
    applied_by UUID NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (match_id,revision)
  );
  CREATE OR REPLACE FUNCTION protect_match_operation_rule_binding() RETURNS trigger AS $$
  BEGIN RAISE EXCEPTION 'Match rule bindings are append-only'; END; $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS protect_match_rule_binding ON match_operation_rule_bindings;
  CREATE TRIGGER protect_match_rule_binding BEFORE UPDATE OR DELETE ON match_operation_rule_bindings
    FOR EACH ROW EXECUTE FUNCTION protect_match_operation_rule_binding();
`;
export async function applyMatchOperationRulesMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl }); const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
    if (!(await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=22")).rowCount) {
      await client.query(matchOperationRulesSql);
      await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(22,'immutable-match-operation-rule-bindings')");
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); await pool.end(); }
}

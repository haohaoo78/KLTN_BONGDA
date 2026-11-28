import { Pool } from "pg";

export async function applyRefereeConfigurationMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1010");
      if (!applied.rowCount) {
        await client.query(`CREATE TABLE tournament_referee_configurations (
          tournament_id UUID PRIMARY KEY,
          configuration JSONB NOT NULL CHECK (jsonb_typeof(configuration)='object'),
          revision INTEGER NOT NULL CHECK (revision>0),
          updated_by UUID NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(1010,$1)", ["official-referee-configuration-and-scoped-capabilities"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

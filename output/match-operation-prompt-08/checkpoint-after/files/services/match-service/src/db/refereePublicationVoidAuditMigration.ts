import { Pool } from "pg";

/** Add audit metadata; no publication or schedule is changed by this migration. */
export async function applyRefereePublicationVoidAuditMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      if (!(await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1013")).rowCount) {
        await client.query("ALTER TABLE schedule_referee_publications ADD COLUMN voided_at TIMESTAMPTZ,ADD COLUMN voided_by UUID,ADD COLUMN void_reason TEXT");
        await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(1013,$1)", ["referee-publication-void-audit-metadata"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

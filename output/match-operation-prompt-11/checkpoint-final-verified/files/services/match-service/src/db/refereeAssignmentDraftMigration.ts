import { Pool } from "pg";

/** Draft crews reserve people without publishing appointments or granting match-operation rights. */
export async function applyRefereeAssignmentDraftMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      if (!(await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1011")).rowCount) {
        await client.query(`CREATE TABLE schedule_referee_drafts (
          schedule_id UUID PRIMARY KEY REFERENCES schedules(id) ON DELETE RESTRICT,
          tournament_id UUID NOT NULL,
          revision INTEGER NOT NULL CHECK(revision>0),
          configuration_revision INTEGER NOT NULL CHECK(configuration_revision>0),
          positions JSONB NOT NULL CHECK(jsonb_typeof(positions)='array'),
          occupied_from TIMESTAMPTZ NOT NULL,
          occupied_to TIMESTAMPTZ NOT NULL CHECK(occupied_to>occupied_from),
          minimum_rest_minutes INTEGER NOT NULL DEFAULT 0 CHECK(minimum_rest_minutes>=0),
          published_at TIMESTAMPTZ,
          updated_by UUID NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE schedule_referee_draft_slots (
          schedule_id UUID NOT NULL REFERENCES schedule_referee_drafts(schedule_id) ON DELETE CASCADE,
          position VARCHAR(60) NOT NULL CHECK(position ~ '^[A-Z][A-Z0-9_]{1,59}$'),
          referee_id UUID NOT NULL,
          PRIMARY KEY(schedule_id,position), UNIQUE(schedule_id,referee_id)
        );
        CREATE INDEX idx_referee_draft_person ON schedule_referee_draft_slots(referee_id,schedule_id);
        CREATE INDEX idx_referee_draft_tournament ON schedule_referee_drafts(tournament_id,schedule_id);`);
        await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(1011,$1)", ["manual-referee-drafts-with-person-reservations"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

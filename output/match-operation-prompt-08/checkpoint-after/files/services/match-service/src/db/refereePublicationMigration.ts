import { Pool } from "pg";

export async function applyRefereePublicationMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      if (!(await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1012")).rowCount) {
        await client.query(`CREATE TABLE schedule_referee_publications (
          schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE RESTRICT,
          revision INTEGER NOT NULL CHECK(revision>0),
          action VARCHAR(20) NOT NULL CHECK(action IN ('PUBLISH','REPLACE')),
          positions JSONB NOT NULL CHECK(jsonb_typeof(positions)='array'),
          slots JSONB NOT NULL CHECK(jsonb_typeof(slots)='array'),
          published_by UUID NOT NULL, published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reason TEXT, request_id UUID NOT NULL, request_hash CHAR(64) NOT NULL,
          schedule_signature CHAR(64) NOT NULL, source_draft_revision INTEGER NOT NULL,
          PRIMARY KEY(schedule_id,revision)
        );
        CREATE INDEX idx_referee_publication_request ON schedule_referee_publications(request_id);
        CREATE TABLE referee_assignment_messages (
          id UUID PRIMARY KEY, schedule_id UUID NOT NULL, publication_revision INTEGER NOT NULL,
          referee_id UUID NOT NULL, position VARCHAR(60) NOT NULL,
          kind VARCHAR(20) NOT NULL CHECK(kind IN ('PUBLISHED','REPLACED_IN','REPLACED_OUT')),
          payload JSONB NOT NULL,
          notification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(notification_status IN ('PENDING','SENT','FAILED')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          FOREIGN KEY(schedule_id,publication_revision) REFERENCES schedule_referee_publications(schedule_id,revision) ON DELETE RESTRICT,
          UNIQUE(schedule_id,publication_revision,referee_id,position,kind)
        );
        CREATE TABLE referee_assignment_email_attempts (
          id UUID PRIMARY KEY, message_id UUID NOT NULL REFERENCES referee_assignment_messages(id) ON DELETE RESTRICT,
          request_id UUID NOT NULL, requested_by UUID NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED')),
          error_code VARCHAR(64), sent_at TIMESTAMPTZ, dispatched_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(message_id,request_id)
        );
        CREATE INDEX idx_referee_assignment_message_schedule ON referee_assignment_messages(schedule_id,publication_revision);
        CREATE INDEX idx_referee_assignment_email_message ON referee_assignment_email_attempts(message_id,created_at DESC);`);
        await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(1012,$1)", ["official-referee-publications-history-and-delivery-outbox"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

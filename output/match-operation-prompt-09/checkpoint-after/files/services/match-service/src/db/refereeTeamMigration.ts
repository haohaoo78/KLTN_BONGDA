import { Pool } from "pg";

/** Add tournament referee membership without touching schedules, assignments or account data. */
export async function applyRefereeTeamMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1009");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE referee_profiles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE TABLE tournament_referee_team (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            referee_profile_id UUID NOT NULL REFERENCES referee_profiles(id) ON DELETE RESTRICT,
            profile JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(profile)='object'),
            added_by UUID NOT NULL,
            notification_status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (notification_status IN ('PENDING','SENT','FAILED')),
            notification_error_code VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(tournament_id,referee_profile_id)
          );
          CREATE INDEX idx_tournament_referee_team_tournament ON tournament_referee_team(tournament_id,created_at,id);
          CREATE TABLE referee_team_access_emails (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            member_id UUID NOT NULL REFERENCES tournament_referee_team(id) ON DELETE RESTRICT,
            request_id UUID NOT NULL,
            operation VARCHAR(10) NOT NULL CHECK (operation IN ('ADD','RESEND')),
            requested_by UUID NOT NULL,
            event_key TEXT NOT NULL UNIQUE,
            status VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts>=0),
            lease_until TIMESTAMPTZ,
            last_attempt_at TIMESTAMPTZ,
            sent_at TIMESTAMPTZ,
            error_code VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(tournament_id,request_id)
          );
          CREATE INDEX idx_referee_team_access_member ON referee_team_access_emails(member_id,created_at DESC,id DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(1009,$1)", ["official-tournament-referee-team-and-access-email-outbox"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

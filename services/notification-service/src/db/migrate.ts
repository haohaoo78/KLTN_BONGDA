import { Pool } from "pg";
import { schemaSql } from "./schema";

export async function runMigrations(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sfl_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const migrations = [
        { version: 1, name: "baseline", sql: schemaSql },
        {
          version: 2,
          name: "email_delivery_logs",
          sql: `CREATE TABLE IF NOT EXISTS email_delivery_logs (
            id BIGSERIAL PRIMARY KEY,
            recipient VARCHAR(255) NOT NULL,
            message_type VARCHAR(40) NOT NULL CHECK (message_type IN ('verification', 'password_reset')),
            status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
            error_code VARCHAR(64),
            provider_message_id VARCHAR(255),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_email_delivery_logs_status_created
            ON email_delivery_logs (status, created_at DESC);`,
        },
        {
          version: 3,
          name: "staff_account_activation_email",
          sql: `ALTER TABLE email_delivery_logs
            DROP CONSTRAINT IF EXISTS email_delivery_logs_message_type_check;
          ALTER TABLE email_delivery_logs
            ADD CONSTRAINT email_delivery_logs_message_type_check
            CHECK (message_type IN ('verification', 'password_reset', 'account_activation'));`,
        },
        {
          version: 4,
          name: "tournament_invitation_email",
          sql: `ALTER TABLE email_delivery_logs
            DROP CONSTRAINT IF EXISTS email_delivery_logs_message_type_check;
          ALTER TABLE email_delivery_logs
            ADD CONSTRAINT email_delivery_logs_message_type_check
            CHECK (message_type IN ('verification', 'password_reset', 'account_activation', 'email_change', 'tournament_invitation'));`,
        },
        {
          version: 5,
          name: "notification_realtime_events",
          sql: `CREATE OR REPLACE FUNCTION notify_user_notification_created() RETURNS trigger AS $$
            BEGIN
              PERFORM pg_notify('sfl_user_notifications', json_build_object(
                'userId', NEW.user_id,
                'notificationId', NEW.id
              )::text);
              RETURN NEW;
            END;
          $$ LANGUAGE plpgsql;
          DROP TRIGGER IF EXISTS notifications_realtime_insert ON notifications;
          CREATE TRIGGER notifications_realtime_insert
            AFTER INSERT ON notifications
            FOR EACH ROW EXECUTE FUNCTION notify_user_notification_created();`,
        },
        {
          version: 6,
          name: "idempotent-in-app-notifications",
          sql: `
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_idempotency_key
              ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;
          `,
        },
        {
          version: 7,
          name: "idempotent-referee-team-access-email",
          sql: `CREATE TABLE referee_access_email_deliveries (
            event_key VARCHAR(255) PRIMARY KEY,
            recipient VARCHAR(255) NOT NULL,
            payload_hash CHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
            error_code VARCHAR(64),
            provider_message_id VARCHAR(255),
            sent_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX idx_referee_access_email_status
            ON referee_access_email_deliveries(status, created_at);`,
        },
      ];
      for (const migration of migrations) {
        const applied = await client.query(
          "SELECT 1 FROM sfl_schema_migrations WHERE version = $1",
          [migration.version],
        );
        if ((applied.rowCount ?? 0) > 0) continue;
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES ($1, $2)",
          [migration.version, migration.name],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[notification-service] database migrations are current");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error("[notification-service] migration failed", error);
    process.exitCode = 1;
  });
}

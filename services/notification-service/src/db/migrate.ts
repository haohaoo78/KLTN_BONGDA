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

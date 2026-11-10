import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

async function applyBaselineMigration(
  databaseUrl: string,
  schemaFile: string,
  databaseName: string,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const schema = readFileSync(join(__dirname, schemaFile), "utf8");
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
      const applied = await client.query(
        "SELECT 1 FROM sfl_schema_migrations WHERE version = 1",
      );
      if (applied.rowCount === 0) {
        await client.query(schema);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (1, $1)",
          ["baseline"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log(`[auth-service] ${databaseName} database migration is current`);
  } finally {
    await pool.end();
  }
}

async function applyAccountMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const migration = readFileSync(
      join(__dirname, "account-migration-v2.sql"),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query(
        "SELECT 1 FROM sfl_schema_migrations WHERE version = 2",
      );
      if (applied.rowCount === 0) {
        await client.query(migration);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (2, $1)",
          ["staff_account_invites"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[auth-service] account database migrations are current");
  } finally {
    await pool.end();
  }
}

async function applyAccountMigrationV3(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const migration = readFileSync(
      join(__dirname, "account-migration-v3.sql"),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query(
        "SELECT 1 FROM sfl_schema_migrations WHERE version = 3",
      );
      if (applied.rowCount === 0) {
        await client.query(migration);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (3, $1)",
          ["role_applications"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[auth-service] role application migration is current");
  } finally {
    await pool.end();
  }
}

async function applyAccountMigrationV4(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const migration = readFileSync(
      join(__dirname, "account-migration-v4.sql"),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query(
        "SELECT 1 FROM sfl_schema_migrations WHERE version = 4",
      );
      if (applied.rowCount === 0) {
        await client.query(migration);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (4, $1)",
          ["school_scoped_role_applications"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[auth-service] school-scope account migration is current");
  } finally {
    await pool.end();
  }
}

async function applyAccountMigrationV5(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const migration = readFileSync(
      join(__dirname, "account-migration-v5.sql"),
      "utf8",
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query(
        "SELECT 1 FROM sfl_schema_migrations WHERE version = 5",
      );
      if (applied.rowCount === 0) {
        await client.query(migration);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (5, $1)",
          ["account-profile-details-and-demo-registry"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[auth-service] profile details migration is current");
  } finally {
    await pool.end();
  }
}

async function applyAccountMigrationV6(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const migration = readFileSync(join(__dirname, "account-migration-v6.sql"), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 6");
      if (applied.rowCount === 0) {
        await client.query(migration);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (6, $1)",
          ["verified-email-change-requests"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[auth-service] email-change migration is current");
  } finally {
    await pool.end();
  }
}

async function applyAccountMigrationV7(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 7");
      if (applied.rowCount === 0) {
        await client.query(`
          ALTER TABLE role_applications
            DROP CONSTRAINT IF EXISTS role_applications_status_check;
          ALTER TABLE role_applications
            ADD CONSTRAINT role_applications_status_check
            CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'));
          ALTER TABLE role_applications
            ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;
          CREATE INDEX IF NOT EXISTS idx_role_applications_owner_status_created
            ON role_applications (user_id, status, created_at DESC);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (7, $1)",
          ["role-application-edit-and-withdraw"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[auth-service] role application edit/withdraw migration is current");
  } finally {
    await pool.end();
  }
}

async function applyAccountMigrationV8(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 8");
      if (applied.rowCount === 0) {
        await client.query(`
          ALTER TABLE users
            ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
            ADD COLUMN IF NOT EXISTS status_reason VARCHAR(500),
            ADD COLUMN IF NOT EXISTS status_changed_by UUID,
            ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;
          UPDATE users
          SET account_status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'LOCKED' END
          WHERE account_status = 'ACTIVE' AND NOT is_active;
          ALTER TABLE users
            DROP CONSTRAINT IF EXISTS users_account_status_check;
          ALTER TABLE users
            ADD CONSTRAINT users_account_status_check
            CHECK (account_status IN ('ACTIVE', 'LOCKED', 'DISABLED'));
          CREATE INDEX IF NOT EXISTS idx_users_account_status_created
            ON users (account_status, created_at DESC);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (8, $1)",
          ["account-status-and-admin-audit"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[auth-service] account status migration is current");
  } finally {
    await pool.end();
  }
}

export async function runMigrations(): Promise<void> {
  const authDatabaseUrl = process.env.DATABASE_URL;
  const accountDatabaseUrl = process.env.ACCOUNT_DATABASE_URL ?? authDatabaseUrl;
  if (!authDatabaseUrl || !accountDatabaseUrl) {
    throw new Error("DATABASE_URL and ACCOUNT_DATABASE_URL must be configured");
  }

  await applyBaselineMigration(authDatabaseUrl, "schema.sql", "auth");
  await applyBaselineMigration(accountDatabaseUrl, "account-schema.sql", "account");
  await applyAccountMigrations(accountDatabaseUrl);
  await applyAccountMigrationV3(accountDatabaseUrl);
  await applyAccountMigrationV4(accountDatabaseUrl);
  await applyAccountMigrationV5(accountDatabaseUrl);
  await applyAccountMigrationV6(accountDatabaseUrl);
  await applyAccountMigrationV7(accountDatabaseUrl);
  await applyAccountMigrationV8(accountDatabaseUrl);
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error("[auth-service] migration failed", error);
    process.exitCode = 1;
  });
}

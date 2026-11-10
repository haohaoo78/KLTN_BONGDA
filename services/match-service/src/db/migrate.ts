import { Pool } from "pg";
import { schemaSql } from "./schema";
import { schemaSql as schedulingSchemaSql } from "./schedulingSchema";
import { schemaSql as disciplineSchemaSql } from "./disciplineSchema";

async function applyBaselineMigration(
  databaseUrl: string,
  schema: string,
  databaseName: string,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
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
    console.log(`[match-service] ${databaseName} database migration is current`);
  } finally {
    await pool.end();
  }
}

export async function runMigrations(): Promise<void> {
  const matchDatabaseUrl = process.env.DATABASE_URL;
  const schedulingDatabaseUrl = process.env.SCHEDULING_DATABASE_URL ?? matchDatabaseUrl;
  const disciplineDatabaseUrl = process.env.DISCIPLINE_DATABASE_URL ?? matchDatabaseUrl;
  if (!matchDatabaseUrl || !schedulingDatabaseUrl || !disciplineDatabaseUrl) {
    throw new Error(
      "DATABASE_URL, SCHEDULING_DATABASE_URL, and DISCIPLINE_DATABASE_URL must be configured",
    );
  }

  await applyBaselineMigration(matchDatabaseUrl, schemaSql, "match");
  await applyMatchFixtureMigration(matchDatabaseUrl);
  await applyMatchPauseRequestMigration(matchDatabaseUrl);
  await applyMatchApprovalMigration(matchDatabaseUrl);
  await applyBaselineMigration(schedulingDatabaseUrl, schedulingSchemaSql, "scheduling");
  await applyBaselineMigration(disciplineDatabaseUrl, disciplineSchemaSql, "discipline");
}

async function applyMatchApprovalMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 4");
      if (applied.rowCount === 0) {
        await client.query(`
          ALTER TABLE match_results
            ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'APPROVED';
          ALTER TABLE match_results DROP CONSTRAINT IF EXISTS match_results_status_check;
          ALTER TABLE match_results ADD CONSTRAINT match_results_status_check
            CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));
          ALTER TABLE match_reports ADD COLUMN IF NOT EXISTS review_note TEXT;
          ALTER TABLE match_reports DROP CONSTRAINT IF EXISTS match_reports_status_check;
          ALTER TABLE match_reports ADD CONSTRAINT match_reports_status_check
            CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'));
          CREATE TABLE IF NOT EXISTS match_report_reviews (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            report_id UUID NOT NULL REFERENCES match_reports(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL CHECK (status IN ('APPROVED', 'REJECTED', 'REVISION_REQUIRED')),
            review_note TEXT,
            reviewed_by UUID NOT NULL,
            reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_match_report_reviews_report_date
            ON match_report_reviews (report_id, reviewed_at DESC);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (4, $1)",
          ["referee-report-approval-gates-official-results"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function applyMatchFixtureMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query(
        "SELECT 1 FROM sfl_schema_migrations WHERE version = 2",
      );
      if (applied.rowCount === 0) {
        await client.query(`
          ALTER TABLE matches ALTER COLUMN match_date DROP NOT NULL;
          ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_status_check;
          ALTER TABLE matches ADD CONSTRAINT matches_status_check CHECK (
            status IN ('UNSCHEDULED', 'SCHEDULED', 'LINEUP_CONFIRMED', 'IN_PROGRESS', 'FINISHED', 'VERIFIED', 'LOCKED', 'CANCELLED', 'POSTPONED')
          );
          ALTER TABLE matches ADD COLUMN IF NOT EXISTS draw_version_id UUID;
          ALTER TABLE matches ADD COLUMN IF NOT EXISTS fixture_key TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_fixture_key
            ON matches (tournament_id, fixture_key) WHERE fixture_key IS NOT NULL;
          CREATE TABLE IF NOT EXISTS match_fixture_generations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            draw_version_id UUID NOT NULL UNIQUE,
            legs SMALLINT NOT NULL,
            generated_by UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT match_fixture_generations_legs_check CHECK (legs IN (1, 2))
          );
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (2, $1)",
          ["group-stage-fixture-generation"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function applyMatchPauseRequestMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query(
        "SELECT 1 FROM sfl_schema_migrations WHERE version = 3",
      );
      if (applied.rowCount === 0) {
        await client.query(`
          CREATE TABLE match_pause_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            match_id UUID NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
            requested_by UUID NOT NULL,
            reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 2000),
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
            reviewed_by UUID,
            reviewed_at TIMESTAMPTZ,
            review_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX idx_match_pause_requests_match_created
            ON match_pause_requests (match_id, created_at DESC);
          CREATE UNIQUE INDEX idx_match_pause_requests_one_pending
            ON match_pause_requests (match_id) WHERE status = 'PENDING';
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (3, $1)",
          ["admin-match-pause-requests"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error("[match-service] migration failed", error);
    process.exitCode = 1;
  });
}

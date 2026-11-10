import { Pool } from "pg";
import { schemaSql } from "./schema";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type CatalogInstitution = {
  name: string;
  shortName: string;
  code: string;
  institutionType: "UNIVERSITY" | "COLLEGE";
  address: string | null;
  officialWebsite: string;
  dataSourceUrl: string;
};

function readInstitutionCatalog(): CatalogInstitution[] {
  return JSON.parse(
    readFileSync(join(__dirname, "institution-catalog.json"), "utf8"),
  ) as CatalogInstitution[];
}

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
    const migrations = [
      {
        version: 1,
        name: "baseline",
        sql: schemaSql,
      },
      {
        version: 2,
        name: "organization-usecase-profiles",
        sql: `
          ALTER TABLE institutions
            ADD COLUMN IF NOT EXISTS institution_type VARCHAR(30) NOT NULL DEFAULT 'UNIVERSITY';
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = 'institutions_type_check'
                AND conrelid = 'institutions'::regclass
            ) THEN
              ALTER TABLE institutions
                ADD CONSTRAINT institutions_type_check
                CHECK (institution_type IN ('UNIVERSITY', 'COLLEGE', 'OTHER'));
            END IF;
          END $$;
          ALTER TABLE teams ADD COLUMN IF NOT EXISTS unit_name VARCHAR(255);
          ALTER TABLE teams ADD COLUMN IF NOT EXISTS representative_name VARCHAR(255);
          ALTER TABLE teams ADD COLUMN IF NOT EXISTS kit_color VARCHAR(40);
          ALTER TABLE players ALTER COLUMN user_id DROP NOT NULL;
          ALTER TABLE players ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
          ALTER TABLE players ADD COLUMN IF NOT EXISTS birth_date DATE;
          ALTER TABLE players ADD COLUMN IF NOT EXISTS student_id VARCHAR(100);
          ALTER TABLE players ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
          ALTER TABLE players ADD COLUMN IF NOT EXISTS evidence_url VARCHAR(1000);
          CREATE INDEX IF NOT EXISTS idx_players_student_id ON players (student_id);
        `,
      },
      {
        version: 3,
        name: "enforce-one-active-team-per-player-account",
        sql: `
          CREATE UNIQUE INDEX IF NOT EXISTS idx_players_one_active_team_per_user
            ON players (user_id) WHERE user_id IS NOT NULL AND left_at IS NULL;
        `,
      },
      {
        version: 4,
        name: "player-team-requests-profile",
        sql: `
          ALTER TABLE player_requests ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
          ALTER TABLE player_requests ADD COLUMN IF NOT EXISTS birth_date DATE;
          ALTER TABLE player_requests ADD COLUMN IF NOT EXISTS student_id VARCHAR(100);
          ALTER TABLE player_requests ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
          ALTER TABLE player_requests DROP CONSTRAINT IF EXISTS player_requests_unique;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_player_requests_pending_unique
            ON player_requests (team_id, user_id) WHERE status = 'PENDING';
        `,
      },
      {
        version: 5,
        name: "institution-catalog-metadata",
        sql: `
          ALTER TABLE institutions ADD COLUMN IF NOT EXISTS short_name VARCHAR(100);
          ALTER TABLE institutions ADD COLUMN IF NOT EXISTS admission_code VARCHAR(50);
          ALTER TABLE institutions ADD COLUMN IF NOT EXISTS official_website VARCHAR(500);
          ALTER TABLE institutions ADD COLUMN IF NOT EXISTS city VARCHAR(100);
          ALTER TABLE institutions ADD COLUMN IF NOT EXISTS data_source_url VARCHAR(1000);
          ALTER TABLE institutions ADD COLUMN IF NOT EXISTS data_collected_at DATE;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_institutions_admission_code_unique
            ON institutions (UPPER(admission_code))
            WHERE admission_code IS NOT NULL AND BTRIM(admission_code) <> '';
          CREATE INDEX IF NOT EXISTS idx_institutions_type_active_name
            ON institutions (institution_type, is_active, name);
        `,
      },
      {
        version: 6,
        name: "school_scoped_club_requests",
        sql: `
          ALTER TABLE teams ADD COLUMN IF NOT EXISTS short_name VARCHAR(100);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_school_name_unique
            ON teams (institution_id, LOWER(name))
            WHERE institution_id IS NOT NULL;
          CREATE TABLE IF NOT EXISTS club_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            applicant_id UUID NOT NULL,
            institution_id UUID NOT NULL REFERENCES institutions(id),
            name VARCHAR(255) NOT NULL,
            captain_name VARCHAR(255) NOT NULL,
            short_name VARCHAR(100),
            description TEXT,
            logo_url VARCHAR(500),
            unit_name VARCHAR(255),
            contact_email VARCHAR(255) NOT NULL,
            contact_phone VARCHAR(50) NOT NULL,
            initial_members JSONB NOT NULL DEFAULT '[]'::jsonb,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            decision_note TEXT,
            reviewed_by UUID,
            reviewed_at TIMESTAMPTZ,
            approved_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT club_requests_status_check
              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'))
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_club_requests_pending_school_name
            ON club_requests (institution_id, LOWER(name))
            WHERE status = 'PENDING';
          CREATE INDEX IF NOT EXISTS idx_club_requests_school_status_created
            ON club_requests (institution_id, status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_club_requests_applicant_created
            ON club_requests (applicant_id, created_at DESC);
          CREATE OR REPLACE FUNCTION update_club_request_updated_at_column()
          RETURNS TRIGGER AS $$
          BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
          DROP TRIGGER IF EXISTS update_club_requests_updated_at ON club_requests;
          CREATE TRIGGER update_club_requests_updated_at
            BEFORE UPDATE ON club_requests
            FOR EACH ROW EXECUTE FUNCTION update_club_request_updated_at_column();
        `,
      },
      {
        version: 7,
        name: "verified-hcm-institution-catalog",
        sql: "SELECT 1",
      },
      {
        version: 8,
        name: "complete-hutech-hcm-address-catalog",
        sql: `
          UPDATE institutions
          SET address = 'Trụ sở Điện Biên Phủ: 475A Điện Biên Phủ, phường Thạnh Mỹ Tây, TP. Hồ Chí Minh; Cơ sở Ung Văn Khiêm: 31/36 Ung Văn Khiêm, phường Thạnh Mỹ Tây, TP. Hồ Chí Minh; Trung tâm Đào tạo Nhân lực chất lượng cao: Phân khu Đào tạo E1, Khu Công nghệ cao, phường Tăng Nhơn Phú, TP. Hồ Chí Minh; Viện Công nghệ Cao: Lô E2b-4, đường D1, Khu Công nghệ cao, phường Tăng Nhơn Phú, TP. Hồ Chí Minh'
          WHERE code = 'SFL-HCM-HUTECH'
            AND address = 'Trụ sở Điện Biên Phủ: 475A Điện Biên Phủ, phường Thạnh Mỹ Tây, TP. Hồ Chí Minh; Cơ sở Ung Văn Khiêm: 31/36 Ung Văn Khiêm, phường Thạnh Mỹ Tây, TP. Hồ Chí Minh'
        `,
      },
      {
        version: 9,
        name: "player-membership-request-workflow",
        sql: `
          ALTER TABLE player_requests
            DROP CONSTRAINT IF EXISTS player_requests_status_check;
          ALTER TABLE player_requests
            ADD CONSTRAINT player_requests_status_check
            CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'));
          ALTER TABLE player_requests
            ADD COLUMN IF NOT EXISTS reviewed_by UUID,
            ADD COLUMN IF NOT EXISTS decision_reason TEXT,
            ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ;

          CREATE TABLE IF NOT EXISTS player_leave_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            team_id UUID NOT NULL REFERENCES teams(id),
            player_id UUID NOT NULL REFERENCES players(id),
            user_id UUID NOT NULL,
            reason TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_by UUID,
            reviewed_at TIMESTAMPTZ,
            decision_reason TEXT,
            last_reminded_at TIMESTAMPTZ,
            CONSTRAINT player_leave_requests_status_check
              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'))
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_player_leave_pending_unique
            ON player_leave_requests (player_id) WHERE status = 'PENDING';
          CREATE INDEX IF NOT EXISTS idx_player_leave_team_status
            ON player_leave_requests (team_id, status, requested_at);
          CREATE INDEX IF NOT EXISTS idx_player_leave_user_requested
            ON player_leave_requests (user_id, requested_at DESC);
        `,
      },
      {
        version: 10,
        name: "institution-lifecycle-and-audit",
        sql: `
          ALTER TABLE institutions
            ADD COLUMN IF NOT EXISTS status VARCHAR(20);
          UPDATE institutions
          SET status = CASE WHEN is_active THEN 'ACTIVE' ELSE 'SUSPENDED' END
          WHERE status IS NULL;
          ALTER TABLE institutions
            ALTER COLUMN status SET DEFAULT 'DRAFT',
            ALTER COLUMN status SET NOT NULL,
            ALTER COLUMN code DROP NOT NULL;
          ALTER TABLE institutions DROP CONSTRAINT IF EXISTS institutions_status_check;
          ALTER TABLE institutions
            ADD CONSTRAINT institutions_status_check
            CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED'));
          CREATE TABLE IF NOT EXISTS institution_change_history (
            id BIGSERIAL PRIMARY KEY,
            institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE RESTRICT,
            actor_id UUID NOT NULL,
            action VARCHAR(30) NOT NULL,
            before_data JSONB,
            after_data JSONB NOT NULL,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT institution_change_history_action_check
              CHECK (action IN ('CREATED', 'UPDATED', 'STATUS_CHANGED'))
          );
          CREATE INDEX IF NOT EXISTS idx_institution_change_history_institution
            ON institution_change_history (institution_id, changed_at DESC);
        `,
      },
      {
        version: 11,
        name: "team-registration-school-snapshot",
        sql: `
          ALTER TABLE team_registrations ADD COLUMN IF NOT EXISTS institution_id UUID;
          UPDATE team_registrations tr
          SET institution_id = t.institution_id
          FROM teams t
          WHERE tr.team_id = t.id AND tr.institution_id IS NULL;
          CREATE INDEX IF NOT EXISTS idx_team_registrations_tournament_institution_status
            ON team_registrations (tournament_id, institution_id, status);
        `,
      },
      {
        version: 12,
        name: "player-request-profile-snapshot",
        sql: `
          ALTER TABLE player_requests
            ADD COLUMN IF NOT EXISTS profile_data JSONB NOT NULL DEFAULT '{}'::jsonb;
        `,
      },
      {
        version: 13,
        name: "tournament-roster-review-workflow",
        sql: `
          ALTER TABLE rosters
            ADD COLUMN IF NOT EXISTS review_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
            ADD COLUMN IF NOT EXISTS review_note TEXT,
            ADD COLUMN IF NOT EXISTS reviewed_by UUID,
            ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
          UPDATE rosters
          SET review_status = 'APPROVED',
              reviewed_at = COALESCE(reviewed_at, verified_at)
          WHERE is_verified = TRUE AND review_status = 'PENDING';
          CREATE INDEX IF NOT EXISTS idx_rosters_tournament_review_status
            ON rosters (tournament_id, review_status, team_id);
        `,
      },
      {
        version: 14,
        name: "tournament-roster-lineup-roles",
        sql: `
          ALTER TABLE rosters
            ADD COLUMN IF NOT EXISTS lineup_role VARCHAR(20) NOT NULL DEFAULT 'SUBSTITUTE',
            ADD COLUMN IF NOT EXISTS is_goalkeeper BOOLEAN NOT NULL DEFAULT FALSE;
          ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_lineup_role_check;
          ALTER TABLE rosters ADD CONSTRAINT rosters_lineup_role_check
            CHECK (lineup_role IN ('STARTER', 'SUBSTITUTE'));
          ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_goalkeeper_role_check;
          ALTER TABLE rosters ADD CONSTRAINT rosters_goalkeeper_role_check
            CHECK (is_goalkeeper = FALSE OR lineup_role = 'STARTER');
          CREATE UNIQUE INDEX IF NOT EXISTS idx_rosters_one_starting_goalkeeper
            ON rosters (team_id, tournament_id) WHERE lineup_role = 'STARTER' AND is_goalkeeper = TRUE;
        `,
      },
    ];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      for (const migration of migrations) {
        const applied = await client.query(
          "SELECT 1 FROM sfl_schema_migrations WHERE version = $1",
          [migration.version],
        );
        if (applied.rows.length > 0) continue;
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES ($1, $2)",
          [migration.version, migration.name],
        );
      }
      const collectedAt = new Date().toISOString().slice(0, 10);
      for (const institution of readInstitutionCatalog()) {
        await client.query(
          `INSERT INTO institutions
             (name, short_name, code, institution_type, address, official_website, city,
              data_source_url, data_collected_at, status, is_active)
           SELECT $1, $2, $3, $4, $5, $6, 'TP. Hồ Chí Minh', $7, $8::date, 'DRAFT', FALSE
           WHERE NOT EXISTS (
             SELECT 1 FROM institutions
             WHERE LOWER(name) = LOWER($1::varchar)
                OR UPPER(code) = UPPER($3::varchar)
                OR LOWER(short_name) = LOWER($2::varchar)
           )
           ON CONFLICT DO NOTHING`,
          [
            institution.name,
            institution.shortName,
            institution.code,
            institution.institutionType,
            institution.address,
            institution.officialWebsite,
            institution.dataSourceUrl,
            collectedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[organization-service] database migrations are current");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error("[organization-service] migration failed", error);
    process.exitCode = 1;
  });
}

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
      {
        version: 15,
        name: "durable-tournament-registration-decision-outbox",
        sql: `
          CREATE TABLE IF NOT EXISTS team_registration_decision_outbox (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            registration_id UUID NOT NULL,
            team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            tournament_id UUID NOT NULL,
            institution_id UUID,
            desired_status VARCHAR(20) NOT NULL CHECK (desired_status IN ('APPROVED', 'REJECTED', 'WITHDRAWN')),
            approved_by UUID,
            notes TEXT,
            state VARCHAR(20) NOT NULL DEFAULT 'PENDING'
              CHECK (state IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            locked_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_outbox_active_registration
            ON team_registration_decision_outbox (registration_id)
            WHERE state IN ('PENDING', 'PROCESSING');
          CREATE INDEX IF NOT EXISTS idx_registration_outbox_due
            ON team_registration_decision_outbox (next_attempt_at, created_at)
            WHERE state IN ('PENDING', 'PROCESSING');
          CREATE INDEX IF NOT EXISTS idx_registration_outbox_team_active
            ON team_registration_decision_outbox (team_id)
            WHERE state IN ('PENDING', 'PROCESSING');
        `,
      },
      {
        version: 16,
        name: "tournament-player-invitations-and-team-application-history",
        sql: `
          ALTER TABLE team_registrations DROP CONSTRAINT IF EXISTS team_registrations_status_check;
          ALTER TABLE team_registrations ADD CONSTRAINT team_registrations_status_check
            CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'WITHDRAWN'));
          ALTER TABLE team_registrations
            ADD COLUMN IF NOT EXISTS submitted_roster JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
          ALTER TABLE rosters
            ADD COLUMN IF NOT EXISTS competition_role VARCHAR(24) NOT NULL DEFAULT 'PLAYER',
            ADD COLUMN IF NOT EXISTS player_name_snapshot VARCHAR(255),
            ADD COLUMN IF NOT EXISTS student_id_snapshot VARCHAR(100),
            ADD COLUMN IF NOT EXISTS jersey_number_snapshot INTEGER,
            ADD COLUMN IF NOT EXISTS position_snapshot VARCHAR(50);
          UPDATE rosters r SET
            player_name_snapshot = COALESCE(r.player_name_snapshot, p.full_name),
            student_id_snapshot = COALESCE(r.student_id_snapshot, p.student_id),
            jersey_number_snapshot = COALESCE(r.jersey_number_snapshot, p.jersey_number),
            position_snapshot = COALESCE(r.position_snapshot, p.position)
          FROM players p WHERE p.id = r.player_id;
          ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_competition_role_check;
          ALTER TABLE rosters ADD CONSTRAINT rosters_competition_role_check
            CHECK (competition_role IN ('PLAYER', 'PLAYING_CAPTAIN', 'VICE_CAPTAIN'));

          CREATE TABLE IF NOT EXISTS tournament_player_invitations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            player_user_id UUID NOT NULL,
            invited_by UUID NOT NULL,
            competition_role VARCHAR(24) NOT NULL DEFAULT 'PLAYER',
            lineup_role VARCHAR(20) NOT NULL DEFAULT 'SUBSTITUTE',
            is_goalkeeper BOOLEAN NOT NULL DEFAULT FALSE,
            proposed_jersey_number INTEGER,
            position_snapshot VARCHAR(50),
            message TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            expires_at TIMESTAMPTZ NOT NULL,
            last_reminded_at TIMESTAMPTZ,
            responded_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT tournament_player_invitation_role_check
              CHECK (competition_role IN ('PLAYER', 'PLAYING_CAPTAIN', 'VICE_CAPTAIN')),
            CONSTRAINT tournament_player_invitation_lineup_check
              CHECK (lineup_role IN ('STARTER', 'SUBSTITUTE')),
            CONSTRAINT tournament_player_invitation_status_check
              CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED')),
            CONSTRAINT tournament_player_invitation_keeper_check
              CHECK (is_goalkeeper = FALSE OR lineup_role = 'STARTER'),
            CONSTRAINT tournament_player_invitation_jersey_check
              CHECK (proposed_jersey_number IS NULL OR proposed_jersey_number BETWEEN 1 AND 99)
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_invitation_active_player
            ON tournament_player_invitations (tournament_id, player_id)
            WHERE status IN ('PENDING', 'ACCEPTED');
          CREATE INDEX IF NOT EXISTS idx_tournament_invitation_player
            ON tournament_player_invitations (player_user_id, status, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_tournament_invitation_team
            ON tournament_player_invitations (team_id, tournament_id, status, created_at DESC);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_invitation_playing_captain
            ON tournament_player_invitations (team_id, tournament_id)
            WHERE competition_role='PLAYING_CAPTAIN' AND status IN ('PENDING','ACCEPTED');
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_invitation_vice_captain
            ON tournament_player_invitations (team_id, tournament_id)
            WHERE competition_role='VICE_CAPTAIN' AND status IN ('PENDING','ACCEPTED');

          CREATE TABLE IF NOT EXISTS team_registration_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            registration_id UUID NOT NULL REFERENCES team_registrations(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            action VARCHAR(24) NOT NULL CHECK (action IN ('SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'WITHDRAWN', 'LOCKED')),
            roster_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
            note TEXT,
            actor_id UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (registration_id, version, action)
          );
          CREATE INDEX IF NOT EXISTS idx_registration_versions_history
            ON team_registration_versions (registration_id, created_at DESC);
        `,
      },
      {
        version: 17,
        name: "durable-organization-notification-outbox",
        sql: `
          CREATE TABLE IF NOT EXISTS organization_notification_outbox (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            type VARCHAR(50) NOT NULL CHECK (type IN ('TEAM_MEMBERSHIP','TOURNAMENT_INVITATION','TOURNAMENT_REGISTRATION','SYSTEM')),
            title VARCHAR(255) NOT NULL,
            body TEXT NOT NULL,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            state VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','PROCESSING','SENT')),
            attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            locked_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            delivered_at TIMESTAMPTZ
          );
          CREATE INDEX IF NOT EXISTS idx_organization_notification_outbox_due
            ON organization_notification_outbox(next_attempt_at,created_at)
            WHERE state IN ('PENDING','PROCESSING');
        `,
      },
      {
        version: 18,
        name: "approved-team-registration-withdrawal-workflow",
        sql: `
          CREATE TABLE IF NOT EXISTS team_registration_withdrawal_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            registration_id UUID NOT NULL REFERENCES team_registrations(id) ON DELETE CASCADE,
            team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            tournament_id UUID NOT NULL,
            requested_by UUID NOT NULL,
            reason TEXT NOT NULL CHECK (char_length(BTRIM(reason)) >= 10),
            status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING','APPROVED','REJECTED')),
            decision_note TEXT,
            decided_by UUID,
            decided_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK ((status = 'PENDING' AND decided_at IS NULL AND decided_by IS NULL)
              OR (status <> 'PENDING' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_team_withdrawal_one_pending
            ON team_registration_withdrawal_requests(registration_id)
            WHERE status = 'PENDING';
          CREATE INDEX IF NOT EXISTS idx_team_withdrawal_tournament_status
            ON team_registration_withdrawal_requests(tournament_id, status, created_at DESC);
        `,
      },
      {
        version: 19,
        name: "retryable-approved-team-withdrawal-decision",
        sql: `
          ALTER TABLE team_registration_withdrawal_requests
            ADD COLUMN IF NOT EXISTS desired_decision VARCHAR(16);
          ALTER TABLE team_registration_withdrawal_requests
            DROP CONSTRAINT IF EXISTS team_registration_withdrawal_requests_status_check;
          ALTER TABLE team_registration_withdrawal_requests
            ADD CONSTRAINT team_registration_withdrawal_requests_status_check
            CHECK (status IN ('PENDING','PROCESSING','APPROVED','REJECTED'));
          DROP INDEX IF EXISTS idx_team_withdrawal_one_pending;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_team_withdrawal_one_pending
            ON team_registration_withdrawal_requests(registration_id)
            WHERE status IN ('PENDING','PROCESSING');
          ALTER TABLE team_registration_withdrawal_requests
            DROP CONSTRAINT IF EXISTS team_registration_withdrawal_requests_check;
          ALTER TABLE team_registration_withdrawal_requests
            ADD CONSTRAINT team_registration_withdrawal_requests_decision_state_check
            CHECK (
              (status='PENDING' AND decided_by IS NULL AND decided_at IS NULL AND desired_decision IS NULL)
              OR (status='PROCESSING' AND decided_by IS NOT NULL AND decided_at IS NULL AND desired_decision IN ('APPROVED','REJECTED'))
              OR (status IN ('APPROVED','REJECTED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND desired_decision IS NULL)
            );
        `,
      },
      {
        version: 20,
        name: "fifo-tournament-registration-review-queue",
        sql: `
          ALTER TABLE team_registrations
            DROP CONSTRAINT IF EXISTS team_registrations_status_check;
          ALTER TABLE team_registrations
            ADD CONSTRAINT team_registrations_status_check
            CHECK (status IN ('PENDING','APPROVED','REJECTED','REVISION_REQUIRED','NEEDS_SUPPLEMENT','WITHDRAWN'));
          ALTER TABLE team_registration_versions
            DROP CONSTRAINT IF EXISTS team_registration_versions_action_check;
          ALTER TABLE team_registration_versions
            ADD CONSTRAINT team_registration_versions_action_check
            CHECK (action IN ('SUBMITTED','RESUBMITTED','APPROVED','REJECTED','REVISION_REQUIRED','NEEDS_SUPPLEMENT','WITHDRAWN','LOCKED'));
          ALTER TABLE team_registrations
            ADD COLUMN IF NOT EXISTS submission_sequence BIGINT,
            ADD COLUMN IF NOT EXISTS supplement_deadline TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS supplement_completed_at TIMESTAMPTZ;
          WITH ordered AS (
            SELECT id, ROW_NUMBER() OVER (
              PARTITION BY tournament_id ORDER BY COALESCE(submitted_at, registered_at), registered_at, id
            ) AS sequence
            FROM team_registrations
          )
          UPDATE team_registrations registration
          SET submission_sequence = COALESCE(registration.submission_sequence, ordered.sequence),
              submitted_at = COALESCE(registration.submitted_at, registration.registered_at)
          FROM ordered WHERE ordered.id = registration.id;
          ALTER TABLE team_registrations
            ALTER COLUMN submission_sequence SET NOT NULL;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_team_registrations_submission_sequence
            ON team_registrations(tournament_id, submission_sequence);
          CREATE INDEX IF NOT EXISTS idx_team_registrations_fifo_queue
            ON team_registrations(tournament_id, status, submission_sequence);
          CREATE OR REPLACE FUNCTION prevent_team_registration_submission_order_change()
          RETURNS trigger AS $$
          BEGIN
            IF OLD.submission_sequence IS NOT NULL AND NEW.submission_sequence IS DISTINCT FROM OLD.submission_sequence THEN
              RAISE EXCEPTION 'submission_sequence is immutable after submission' USING ERRCODE = '23514';
            END IF;
            IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
              RAISE EXCEPTION 'submitted_at is immutable after submission' USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
          END;
          $$ LANGUAGE plpgsql;
          DROP TRIGGER IF EXISTS team_registrations_submission_order_immutable ON team_registrations;
          CREATE TRIGGER team_registrations_submission_order_immutable
            BEFORE UPDATE OF submission_sequence, submitted_at ON team_registrations
            FOR EACH ROW EXECUTE FUNCTION prevent_team_registration_submission_order_change();
        `,
      },
      {
        version: 21,
        name: "approved-registration-review-and-revocation-audit",
        sql: `
          ALTER TABLE team_registration_versions
            DROP CONSTRAINT IF EXISTS team_registration_versions_action_check;
          ALTER TABLE team_registration_versions
            ADD CONSTRAINT team_registration_versions_action_check
            CHECK (action IN (
              'SUBMITTED','RESUBMITTED','APPROVED','REJECTED','REVISION_REQUIRED',
              'NEEDS_SUPPLEMENT','WITHDRAWN','LOCKED','APPROVAL_REVIEW_OPENED',
              'APPROVAL_REVIEW_RESPONSE','APPROVAL_REVIEW_RETAINED','APPROVAL_REVOKED'
            ));
          CREATE TABLE IF NOT EXISTS team_registration_approval_reviews (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            registration_id UUID NOT NULL REFERENCES team_registrations(id),
            requested_by UUID NOT NULL,
            reason TEXT NOT NULL CHECK (char_length(BTRIM(reason)) BETWEEN 10 AND 2000),
            response_deadline TIMESTAMPTZ NOT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
              CHECK (status IN ('OPEN','RESPONDED','RETAINED','REVOKED')),
            team_response TEXT,
            responded_at TIMESTAMPTZ,
            decision_note TEXT,
            decided_by UUID,
            decided_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK ((status IN ('OPEN','RESPONDED') AND decided_at IS NULL AND decided_by IS NULL)
              OR (status IN ('RETAINED','REVOKED') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)),
            CHECK ((status = 'OPEN' AND responded_at IS NULL AND team_response IS NULL)
              OR (status = 'RESPONDED' AND responded_at IS NOT NULL AND team_response IS NOT NULL)
              OR (status IN ('RETAINED','REVOKED') AND (responded_at IS NULL OR (responded_at IS NOT NULL AND team_response IS NOT NULL))))
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_team_registration_one_open_review
            ON team_registration_approval_reviews(registration_id)
            WHERE status IN ('OPEN','RESPONDED');
          CREATE INDEX IF NOT EXISTS idx_team_registration_reviews_queue
            ON team_registration_approval_reviews(registration_id,status,created_at DESC);
          ALTER TABLE team_registration_decision_outbox
            ADD COLUMN IF NOT EXISTS source_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
            ADD COLUMN IF NOT EXISTS action_kind VARCHAR(32) NOT NULL DEFAULT 'DECISION',
            ADD COLUMN IF NOT EXISTS approval_review_id UUID REFERENCES team_registration_approval_reviews(id);
        `,
      },
      {
        version: 22,
        name: "approved-registration-review-supplement-decisions",
        sql: `
          ALTER TABLE team_registration_decision_outbox
            DROP CONSTRAINT IF EXISTS team_registration_decision_outbox_desired_status_check;
          ALTER TABLE team_registration_decision_outbox
            ADD CONSTRAINT team_registration_decision_outbox_desired_status_check
            CHECK (desired_status IN ('APPROVED','REJECTED','WITHDRAWN','NEEDS_SUPPLEMENT'));
          ALTER TABLE team_registration_decision_outbox
            ADD COLUMN IF NOT EXISTS supplement_deadline TIMESTAMPTZ;
          DO $$
          DECLARE constraint_row RECORD;
          BEGIN
            FOR constraint_row IN
              SELECT conname FROM pg_constraint
              WHERE conrelid = 'team_registration_approval_reviews'::regclass
                AND contype = 'c'
                AND pg_get_constraintdef(oid) ~ '(status|decided_at|decided_by|responded_at|team_response)'
            LOOP
              EXECUTE format('ALTER TABLE team_registration_approval_reviews DROP CONSTRAINT %I', constraint_row.conname);
            END LOOP;
          END $$;
          ALTER TABLE team_registration_approval_reviews
            ADD CONSTRAINT team_registration_approval_reviews_status_check
            CHECK (status IN ('OPEN','RESPONDED','RETAINED','REVOKED','SUPPLEMENT_REQUIRED'));
          ALTER TABLE team_registration_approval_reviews
            ADD CONSTRAINT team_registration_approval_reviews_resolution_check
            CHECK (
              (status IN ('OPEN','RESPONDED') AND decided_at IS NULL AND decided_by IS NULL)
              OR (status IN ('RETAINED','REVOKED','SUPPLEMENT_REQUIRED') AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
            );
          ALTER TABLE team_registration_approval_reviews
            ADD CONSTRAINT team_registration_approval_reviews_response_check
            CHECK (
              (status = 'OPEN' AND responded_at IS NULL AND team_response IS NULL)
              OR (status = 'RESPONDED' AND responded_at IS NOT NULL AND team_response IS NOT NULL)
              OR (status IN ('RETAINED','REVOKED','SUPPLEMENT_REQUIRED') AND (responded_at IS NULL OR (responded_at IS NOT NULL AND team_response IS NOT NULL)))
            );
        `,
      },
      {
        version: 23,
        name: "review-supplement-keeps-seat-and-revocation-status",
        sql: `
          ALTER TABLE team_registrations DROP CONSTRAINT IF EXISTS team_registrations_status_check;
          ALTER TABLE team_registrations ADD CONSTRAINT team_registrations_status_check
            CHECK (status IN ('PENDING','APPROVED','REJECTED','APPROVAL_REVOKED','REVISION_REQUIRED','NEEDS_SUPPLEMENT','WITHDRAWN'));
          ALTER TABLE team_registration_approval_reviews ADD COLUMN IF NOT EXISTS supplement_deadline TIMESTAMPTZ;
          ALTER TABLE team_registration_approval_reviews ALTER COLUMN status TYPE VARCHAR(24);
          ALTER TABLE team_registration_approval_reviews DROP CONSTRAINT IF EXISTS team_registration_approval_reviews_resolution_check;
          ALTER TABLE team_registration_approval_reviews DROP CONSTRAINT IF EXISTS team_registration_approval_reviews_response_check;
          ALTER TABLE team_registration_approval_reviews ADD CONSTRAINT team_registration_approval_reviews_resolution_check
            CHECK ((status IN ('OPEN','RESPONDED') AND decided_at IS NULL AND decided_by IS NULL)
              OR (status='SUPPLEMENT_REQUIRED' AND ((decided_at IS NULL AND decided_by IS NULL) OR (decided_at IS NOT NULL AND decided_by IS NOT NULL)))
              OR (status IN ('RETAINED','REVOKED') AND decided_at IS NOT NULL AND decided_by IS NOT NULL));
          ALTER TABLE team_registration_approval_reviews ADD CONSTRAINT team_registration_approval_reviews_response_check
            CHECK ((status='OPEN' AND responded_at IS NULL AND team_response IS NULL)
              OR (status='SUPPLEMENT_REQUIRED' AND ((responded_at IS NULL AND team_response IS NULL) OR (responded_at IS NOT NULL AND team_response IS NOT NULL)))
              OR (status = 'RESPONDED' AND responded_at IS NOT NULL AND team_response IS NOT NULL)
              OR (status IN ('RETAINED','REVOKED') AND (responded_at IS NULL OR (responded_at IS NOT NULL AND team_response IS NOT NULL))));
          DROP INDEX IF EXISTS idx_team_registration_one_open_review;
          CREATE UNIQUE INDEX idx_team_registration_one_open_review
            ON team_registration_approval_reviews(registration_id)
            WHERE status IN ('OPEN','RESPONDED','SUPPLEMENT_REQUIRED');
        `,
      },
      {
        version: 24,
        name: "registration-review-status-transition-audit",
        sql: `
          ALTER TABLE team_registration_versions
            DROP CONSTRAINT IF EXISTS team_registration_versions_registration_id_version_action_key;
          CREATE TABLE IF NOT EXISTS team_registration_approval_review_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            review_id UUID NOT NULL REFERENCES team_registration_approval_reviews(id) ON DELETE RESTRICT,
            registration_id UUID NOT NULL REFERENCES team_registrations(id) ON DELETE RESTRICT,
            event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('OPENED','TEAM_RESPONDED','SUPPLEMENT_REQUESTED','RETAINED','REVOKED')),
            status_before VARCHAR(32) NOT NULL,
            status_after VARCHAR(32) NOT NULL,
            actor_id UUID NOT NULL,
            note TEXT,
            roster_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_registration_approval_review_events_timeline
            ON team_registration_approval_review_events(registration_id, created_at, id);
        `,
      },
      {
        version: 25,
        name: "registration-player-overlap-adjustment-and-waitlist",
        sql: `
          ALTER TABLE team_registrations ALTER COLUMN status TYPE VARCHAR(40);
          ALTER TABLE team_registration_versions ALTER COLUMN action TYPE VARCHAR(40);
          ALTER TABLE team_registration_decision_outbox ALTER COLUMN source_status TYPE VARCHAR(40);
          ALTER TABLE team_registrations DROP CONSTRAINT IF EXISTS team_registrations_status_check;
          ALTER TABLE team_registrations ADD CONSTRAINT team_registrations_status_check
            CHECK (status IN ('PENDING','APPROVED','REJECTED','APPROVAL_REVOKED','REVISION_REQUIRED',
              'NEEDS_SUPPLEMENT','WITHDRAWN','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED'));
          ALTER TABLE team_registrations
            ADD COLUMN IF NOT EXISTS registration_conflicts JSONB NOT NULL DEFAULT '[]'::jsonb,
            ADD COLUMN IF NOT EXISTS adjustment_deadline TIMESTAMPTZ;
          ALTER TABLE team_registration_versions DROP CONSTRAINT IF EXISTS team_registration_versions_action_check;
          ALTER TABLE team_registration_versions ADD CONSTRAINT team_registration_versions_action_check
            CHECK (action IN ('SUBMITTED','RESUBMITTED','APPROVED','REJECTED','REVISION_REQUIRED','NEEDS_SUPPLEMENT','WITHDRAWN','LOCKED',
              'APPROVAL_REVIEW_OPENED','APPROVAL_REVIEW_RESPONSE','APPROVAL_REVIEW_RETAINED','APPROVAL_REVOKED',
              'WAITLISTED','CONFLICT_ADJUSTMENT_REQUIRED','ADJUSTMENT_RESUBMITTED','ADJUSTMENT_EXPIRED'));
          CREATE INDEX IF NOT EXISTS idx_team_registrations_conflict_adjustment_deadline
            ON team_registrations (adjustment_deadline) WHERE status='CONFLICT_ADJUSTMENT_REQUIRED';
        `,
      },
      {
        version: 26,
        name: "tournament-invitation-overlap-conflicts",
        sql: `
          ALTER TABLE tournament_player_invitations
            ADD COLUMN IF NOT EXISTS tournament_start_date DATE,
            ADD COLUMN IF NOT EXISTS tournament_end_date DATE,
            ADD COLUMN IF NOT EXISTS tournament_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS conflict_tournament_id UUID,
            ADD COLUMN IF NOT EXISTS conflict_tournament_name VARCHAR(255),
            ADD COLUMN IF NOT EXISTS status_reason TEXT;
          ALTER TABLE tournament_player_invitations
            DROP CONSTRAINT IF EXISTS tournament_player_invitation_status_check;
          ALTER TABLE tournament_player_invitations
            ADD CONSTRAINT tournament_player_invitation_status_check
            CHECK (status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','CANCELLED','CONFLICTED','WITHDRAWN'));
          CREATE INDEX IF NOT EXISTS idx_tournament_invitation_accepted_overlap
            ON tournament_player_invitations (player_id, tournament_start_date, tournament_end_date)
            WHERE status='ACCEPTED';
        `,
      },
      {
        version: 27,
        name: "invalidated-tournament-invitations-and-idempotent-notifications",
        sql: `
          ALTER TABLE tournament_player_invitations
            DROP CONSTRAINT IF EXISTS tournament_player_invitation_status_check;
          ALTER TABLE tournament_player_invitations
            ADD CONSTRAINT tournament_player_invitation_status_check
            CHECK (status IN ('PENDING','ACCEPTED','DECLINED','EXPIRED','CANCELLED','CONFLICTED','INVALIDATED','WITHDRAWN'));
          UPDATE tournament_player_invitations SET status='INVALIDATED',updated_at=NOW()
            WHERE status='CONFLICTED';
          ALTER TABLE organization_notification_outbox
            ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_org_notification_outbox_idempotency
            ON organization_notification_outbox(idempotency_key)
            WHERE idempotency_key IS NOT NULL;
        `,
      },
      {
        version: 28,
        name: "player-tournament-withdrawal-requests",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_player_withdrawal_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            invitation_id UUID NOT NULL REFERENCES tournament_player_invitations(id),
            player_user_id UUID NOT NULL,
            reason TEXT NOT NULL CHECK (length(BTRIM(reason)) >= 5),
            status VARCHAR(16) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING','PROCESSING','APPROVED','REJECTED')),
            desired_decision VARCHAR(16) CHECK (desired_decision IN ('APPROVED','REJECTED')),
            decision_note TEXT,
            decided_by UUID,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            decided_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_player_withdrawal_one_pending
            ON tournament_player_withdrawal_requests(invitation_id)
            WHERE status IN ('PENDING','PROCESSING');
          CREATE INDEX IF NOT EXISTS idx_player_withdrawal_player_history
            ON tournament_player_withdrawal_requests(player_user_id, created_at DESC);
          ALTER TABLE team_registration_versions DROP CONSTRAINT IF EXISTS team_registration_versions_action_check;
          ALTER TABLE team_registration_versions ADD CONSTRAINT team_registration_versions_action_check
            CHECK (action IN ('SUBMITTED','RESUBMITTED','APPROVED','REJECTED','REVISION_REQUIRED','NEEDS_SUPPLEMENT','WITHDRAWN','LOCKED',
              'APPROVAL_REVIEW_OPENED','APPROVAL_REVIEW_RESPONSE','APPROVAL_REVIEW_RETAINED','APPROVAL_REVOKED','WAITLISTED',
              'CONFLICT_ADJUSTMENT_REQUIRED','ADJUSTMENT_RESUBMITTED','ADJUSTMENT_EXPIRED','PLAYER_WITHDRAWAL_ACCEPTED'));
        `,
      },
      {
        version: 29,
        name: "tournament-registration-roster-drafts",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_registration_drafts (
            team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            tournament_id UUID NOT NULL,
            updated_by UUID NOT NULL,
            roster JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(roster) = 'array'),
            notes TEXT NOT NULL DEFAULT '',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (team_id, tournament_id)
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_registration_drafts_updated
            ON tournament_registration_drafts(updated_at DESC);
        `,
      },
      {
        version: 30,
        name: "registration-editing-and-resubmission-metadata",
        sql: `
          ALTER TABLE team_registrations
            ADD COLUMN IF NOT EXISTS resubmission_allowed BOOLEAN NOT NULL DEFAULT FALSE;
          ALTER TABLE tournament_registration_drafts
            ADD COLUMN IF NOT EXISTS registration_id UUID REFERENCES team_registrations(id) ON DELETE CASCADE,
            ADD COLUMN IF NOT EXISTS base_version INTEGER,
            ADD COLUMN IF NOT EXISTS editing_submitted BOOLEAN NOT NULL DEFAULT FALSE;
          ALTER TABLE team_registration_decision_outbox
            ADD COLUMN IF NOT EXISTS resubmission_allowed BOOLEAN NOT NULL DEFAULT FALSE;
        `,
      },
      {
        version: 31,
        name: "approved-registration-amendments-and-locked-player-additions",
        sql: `
          CREATE TABLE IF NOT EXISTS team_registration_change_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            registration_id UUID NOT NULL REFERENCES team_registrations(id) ON DELETE CASCADE,
            request_kind VARCHAR(32) NOT NULL CHECK (request_kind IN ('APPROVED_AMENDMENT','LOCKED_PLAYER_ADDITION')),
            status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','APPROVED','REJECTED')),
            base_version INTEGER NOT NULL,
            previous_roster JSONB NOT NULL CHECK (jsonb_typeof(previous_roster)='array'),
            proposed_roster JSONB NOT NULL CHECK (jsonb_typeof(proposed_roster)='array'),
            reason TEXT NOT NULL,
            requested_by UUID NOT NULL,
            desired_decision VARCHAR(16) CHECK (desired_decision IN ('APPROVED','REJECTED')),
            decided_by UUID,
            decision_note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            decided_at TIMESTAMPTZ,
            effective_at TIMESTAMPTZ
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_one_open_change_request
            ON team_registration_change_requests(registration_id) WHERE status IN ('PENDING','PROCESSING');
          CREATE INDEX IF NOT EXISTS idx_registration_change_request_history
            ON team_registration_change_requests(registration_id, created_at DESC);
          CREATE TABLE IF NOT EXISTS team_registration_change_request_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id UUID NOT NULL REFERENCES team_registration_change_requests(id) ON DELETE CASCADE,
            event_type VARCHAR(32) NOT NULL,
            actor_id UUID NOT NULL,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          ALTER TABLE team_registration_versions DROP CONSTRAINT IF EXISTS team_registration_versions_action_check;
          ALTER TABLE team_registration_versions ADD CONSTRAINT team_registration_versions_action_check
            CHECK (action IN ('SUBMITTED','RESUBMITTED','APPROVED','REJECTED','REVISION_REQUIRED','NEEDS_SUPPLEMENT','WITHDRAWN','LOCKED',
              'APPROVAL_REVIEW_OPENED','APPROVAL_REVIEW_RESPONSE','APPROVAL_REVIEW_RETAINED','APPROVAL_REVOKED','WAITLISTED',
              'CONFLICT_ADJUSTMENT_REQUIRED','ADJUSTMENT_RESUBMITTED','ADJUSTMENT_EXPIRED','PLAYER_WITHDRAWAL_ACCEPTED',
              'APPROVED_ROSTER_AMENDED','LOCKED_ROSTER_PLAYER_ADDED'));
        `,
      },
      {
        version: 32,
        name: "cancellable-team-withdrawal-requests",
        sql: `
          ALTER TABLE team_registration_withdrawal_requests DROP CONSTRAINT IF EXISTS team_registration_withdrawal_requests_status_check;
          ALTER TABLE team_registration_withdrawal_requests ADD CONSTRAINT team_registration_withdrawal_requests_status_check
            CHECK (status IN ('PENDING','PROCESSING','APPROVED','REJECTED','CANCELLED'));
          ALTER TABLE team_registration_withdrawal_requests DROP CONSTRAINT IF EXISTS team_registration_withdrawal_requests_decision_state_check;
          ALTER TABLE team_registration_withdrawal_requests ADD CONSTRAINT team_registration_withdrawal_requests_decision_state_check
            CHECK (
              (status='PENDING' AND decided_by IS NULL AND decided_at IS NULL AND desired_decision IS NULL)
              OR (status='PROCESSING' AND decided_by IS NOT NULL AND decided_at IS NULL AND desired_decision IN ('APPROVED','REJECTED'))
              OR (status IN ('APPROVED','REJECTED','CANCELLED') AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND desired_decision IS NULL)
            );
        `,
      },
      {
        version: 33,
        name: "explicit-registration-draft-changes-state",
        sql: `
          ALTER TABLE tournament_registration_drafts
            ADD COLUMN IF NOT EXISTS draft_state VARCHAR(20) NOT NULL DEFAULT 'DRAFT';
          UPDATE tournament_registration_drafts
            SET draft_state=CASE WHEN editing_submitted THEN 'DRAFT_CHANGES' ELSE 'DRAFT' END;
          ALTER TABLE tournament_registration_drafts
            DROP CONSTRAINT IF EXISTS tournament_registration_drafts_draft_state_check;
          ALTER TABLE tournament_registration_drafts
            ADD CONSTRAINT tournament_registration_drafts_draft_state_check
            CHECK (draft_state IN ('DRAFT','DRAFT_CHANGES'));
        `,
      },
      {
        version: 34,
        name: "registration-waitlist-readiness-metadata",
        sql: `
          ALTER TABLE team_registrations
            ADD COLUMN IF NOT EXISTS waitlist_reason VARCHAR(32);
          ALTER TABLE team_registrations
            DROP CONSTRAINT IF EXISTS team_registrations_waitlist_reason_check;
          ALTER TABLE team_registrations
            ADD CONSTRAINT team_registrations_waitlist_reason_check
            CHECK (waitlist_reason IS NULL OR waitlist_reason IN ('TOURNAMENT_CAPACITY','INSTITUTION_CAPACITY'));
          UPDATE team_registrations SET waitlist_reason='TOURNAMENT_CAPACITY'
            WHERE status='WAITLIST' AND waitlist_reason IS NULL;
        `,
      },
      {
        version: 35,
        name: "unified-pending-registration-review-queue",
        sql: `
          UPDATE team_registrations
          SET status='PENDING', waitlist_reason=NULL
          WHERE status='WAITLIST';
          UPDATE team_registrations
          SET waitlist_reason=NULL
          WHERE waitlist_reason IS NOT NULL;
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

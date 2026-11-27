import { Pool } from "pg";
import { schemaSql } from "./schema";
import { matchOperationRulesSql } from "./matchOperationRulesMigration";
import { matchOperationRulesBaseSql } from "./matchOperationRulesBaseMigration";

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
        name: "tournament-configuration-and-rules",
        sql: `
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organizer_name VARCHAR(255);
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organizer_contact_name VARCHAR(255);
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organizer_email VARCHAR(255);
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS organizer_phone VARCHAR(50);
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS scope VARCHAR(30) NOT NULL DEFAULT 'INTER_SCHOOL';
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS football_format SMALLINT NOT NULL DEFAULT 7;
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS competition_format VARCHAR(40) NOT NULL DEFAULT 'ROUND_ROBIN';
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS min_teams INTEGER NOT NULL DEFAULT 2;
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS min_players INTEGER NOT NULL DEFAULT 7;
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS max_players_per_team INTEGER NOT NULL DEFAULT 25;
          UPDATE tournaments SET min_teams = LEAST(2, max_teams);
          UPDATE tournaments SET min_players = GREATEST(min_players, football_format);
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_status_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_status_check CHECK (
            status IN ('DRAFT', 'OPEN_REGISTRATION', 'REGISTRATION_CLOSED', 'ROSTER_LOCKED', 'PREPARING', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELLED')
          );
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_scope_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_scope_check
            CHECK (scope IN ('SINGLE_INSTITUTION', 'INTER_SCHOOL'));
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_football_format_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_football_format_check
            CHECK (football_format IN (7, 11));
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_competition_format_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_competition_format_check
            CHECK (competition_format IN ('ROUND_ROBIN', 'GROUP_AND_KNOCKOUT', 'KNOCKOUT'));
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_team_limits_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_team_limits_check
            CHECK (min_teams > 0 AND max_teams >= min_teams);
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_player_limits_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_player_limits_check
            CHECK (min_players >= football_format AND max_players_per_team >= min_players);
          CREATE TABLE IF NOT EXISTS tournament_allowed_institutions (
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            institution_id UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (tournament_id, institution_id)
          );
          CREATE TABLE IF NOT EXISTS tournament_rules (
            tournament_id UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
            eligibility_description TEXT NOT NULL DEFAULT '',
            points_for_win INTEGER NOT NULL DEFAULT 3,
            points_for_draw INTEGER NOT NULL DEFAULT 1,
            points_for_loss INTEGER NOT NULL DEFAULT 0,
            advancing_teams_per_group INTEGER NOT NULL DEFAULT 2,
            yellow_cards_for_suspension INTEGER NOT NULL DEFAULT 3,
            suspension_matches INTEGER NOT NULL DEFAULT 1,
            complaint_window_hours INTEGER NOT NULL DEFAULT 24,
            minimum_rest_minutes INTEGER NOT NULL DEFAULT 30,
            match_duration_minutes INTEGER NOT NULL DEFAULT 90,
            forfeit_policy VARCHAR(40) NOT NULL DEFAULT 'ORGANIZER_DECISION',
            forfeit_winner_score INTEGER NOT NULL DEFAULT 3,
            forfeit_loser_score INTEGER NOT NULL DEFAULT 0,
            published_version INTEGER NOT NULL DEFAULT 0,
            published_at TIMESTAMPTZ,
            published_by UUID,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT tournament_rules_points_check CHECK (
              points_for_win >= 0 AND points_for_draw >= 0 AND points_for_loss >= 0
            ),
            CONSTRAINT tournament_rules_advance_check CHECK (advancing_teams_per_group > 0),
            CONSTRAINT tournament_rules_discipline_check CHECK (
              yellow_cards_for_suspension > 0 AND suspension_matches > 0
            ),
            CONSTRAINT tournament_rules_complaint_check CHECK (complaint_window_hours > 0),
            CONSTRAINT tournament_rules_rest_check CHECK (minimum_rest_minutes >= 30),
            CONSTRAINT tournament_rules_duration_check CHECK (match_duration_minutes > 0),
            CONSTRAINT tournament_rules_forfeit_check CHECK (
              forfeit_policy IN ('ORGANIZER_DECISION', 'WALKOVER', 'NO_AUTOMATIC_RESULT')
            ),
            CONSTRAINT tournament_rules_forfeit_score_check CHECK (
              forfeit_winner_score >= 0 AND forfeit_loser_score >= 0
            )
          );
          CREATE TABLE IF NOT EXISTS tournament_ranking_criteria (
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            priority SMALLINT NOT NULL,
            criterion VARCHAR(30) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (tournament_id, priority),
            CONSTRAINT tournament_ranking_criteria_unique UNIQUE (tournament_id, criterion),
            CONSTRAINT tournament_ranking_criterion_check CHECK (
              criterion IN ('POINTS', 'GOAL_DIFFERENCE', 'GOALS_FOR', 'HEAD_TO_HEAD', 'FAIR_PLAY', 'LOT_DRAW')
            )
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_allowed_institutions_institution
            ON tournament_allowed_institutions (institution_id);
        `,
      },
      {
        version: 3,
        name: "tournament-organizer-assignments",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_organizers (
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            user_id UUID NOT NULL,
            assigned_by UUID NOT NULL,
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (tournament_id, user_id)
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_organizers_user
            ON tournament_organizers (user_id);
        `,
      },
      {
        version: 4,
        name: "versioned-group-draw-workflow",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_draw_versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL REFERENCES tournaments(id),
            version INTEGER NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
            method VARCHAR(20) NOT NULL,
            config JSONB NOT NULL DEFAULT '{}'::jsonb,
            change_reason TEXT,
            created_by UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            confirmed_by UUID,
            confirmed_at TIMESTAMPTZ,
            published_by UUID,
            published_at TIMESTAMPTZ,
            CONSTRAINT tournament_draw_versions_status_check
              CHECK (status IN ('DRAFT', 'CONFIRMED', 'PUBLISHED', 'ARCHIVED')),
            CONSTRAINT tournament_draw_versions_method_check
              CHECK (method IN ('RANDOM', 'SEEDED', 'MANUAL')),
            CONSTRAINT tournament_draw_versions_unique UNIQUE (tournament_id, version)
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_draw_versions_latest
            ON tournament_draw_versions (tournament_id, version DESC);
          CREATE TABLE IF NOT EXISTS tournament_draw_groups (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            draw_version_id UUID NOT NULL REFERENCES tournament_draw_versions(id),
            name VARCHAR(100) NOT NULL,
            max_teams INTEGER NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT tournament_draw_groups_capacity_check CHECK (max_teams >= 2),
            CONSTRAINT tournament_draw_groups_name_unique UNIQUE (draw_version_id, name)
          );
          CREATE TABLE IF NOT EXISTS tournament_draw_assignments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            draw_version_id UUID NOT NULL REFERENCES tournament_draw_versions(id),
            group_id UUID NOT NULL REFERENCES tournament_draw_groups(id),
            team_id UUID NOT NULL,
            position INTEGER NOT NULL,
            seed_group INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT tournament_draw_assignments_position_check CHECK (position > 0),
            CONSTRAINT tournament_draw_assignments_seed_check CHECK (seed_group IS NULL OR seed_group > 0),
            CONSTRAINT tournament_draw_assignments_team_unique UNIQUE (draw_version_id, team_id),
            CONSTRAINT tournament_draw_assignments_position_unique UNIQUE (group_id, position)
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_draw_assignments_group
            ON tournament_draw_assignments (group_id, position);
        `,
      },
      {
        version: 5,
        name: "tournament-organizer-audit-history",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_organizer_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            user_id UUID NOT NULL,
            action VARCHAR(20) NOT NULL,
            actor_id UUID NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT tournament_organizer_history_action_check
              CHECK (action IN ('ASSIGNED', 'REVOKED'))
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_organizer_history_tournament_time
            ON tournament_organizer_history (tournament_id, occurred_at DESC);
          WITH inserted_assignments AS (
            INSERT INTO tournament_organizers (tournament_id, user_id, assigned_by)
            SELECT id, created_by, created_by FROM tournaments
            ON CONFLICT (tournament_id, user_id) DO NOTHING
            RETURNING tournament_id, user_id
          )
          INSERT INTO tournament_organizer_history (tournament_id, user_id, action, actor_id)
          SELECT tournament_id, user_id, 'ASSIGNED', user_id FROM inserted_assignments;
        `,
      },
      {
        version: 6,
        name: "tournament-institution-eligibility-and-registration-reservations",
        sql: `
          ALTER TABLE tournaments
            ADD COLUMN IF NOT EXISTS allowed_institution_levels TEXT[] NOT NULL
              DEFAULT ARRAY['UNIVERSITY', 'COLLEGE']::TEXT[],
            ADD COLUMN IF NOT EXISTS all_institutions_allowed BOOLEAN NOT NULL DEFAULT TRUE,
            ADD COLUMN IF NOT EXISTS default_max_teams_per_institution INTEGER;
          UPDATE tournaments t
          SET all_institutions_allowed = NOT EXISTS (
            SELECT 1 FROM tournament_allowed_institutions ai WHERE ai.tournament_id = t.id
          );
          ALTER TABLE tournaments
            ADD CONSTRAINT tournaments_institution_levels_check
              CHECK (allowed_institution_levels <@ ARRAY['UNIVERSITY', 'COLLEGE']::TEXT[]),
            ADD CONSTRAINT tournaments_institution_limit_check
              CHECK (default_max_teams_per_institution IS NULL OR default_max_teams_per_institution > 0);
          CREATE TABLE IF NOT EXISTS tournament_institution_limits (
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            institution_id UUID NOT NULL,
            max_teams INTEGER,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (tournament_id, institution_id),
            CONSTRAINT tournament_institution_limits_max_check CHECK (max_teams IS NULL OR max_teams > 0)
          );
          CREATE TABLE IF NOT EXISTS tournament_registration_reservations (
            registration_id UUID PRIMARY KEY,
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            team_id UUID NOT NULL,
            institution_id UUID NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            persisted_in_organization BOOLEAN NOT NULL DEFAULT FALSE,
            expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT tournament_registration_reservations_status_check
              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'))
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_reservations_active_team
            ON tournament_registration_reservations (tournament_id, team_id)
            WHERE status IN ('PENDING', 'APPROVED');
          CREATE INDEX IF NOT EXISTS idx_registration_reservations_tournament_status
            ON tournament_registration_reservations (tournament_id, status);
          CREATE INDEX IF NOT EXISTS idx_registration_reservations_institution_status
            ON tournament_registration_reservations (tournament_id, institution_id, status);
        `,
      },
      {
        version: 7,
        name: "tournament-organizing-institution",
        sql: `
          ALTER TABLE tournaments
            ADD COLUMN IF NOT EXISTS organizing_institution_id UUID;
          UPDATE tournaments t
          SET organizing_institution_id = (
            SELECT ai.institution_id
            FROM tournament_allowed_institutions ai
            WHERE ai.tournament_id = t.id
            LIMIT 1
          )
          WHERE t.scope = 'SINGLE_INSTITUTION'
            AND t.organizing_institution_id IS NULL
            AND (
              SELECT COUNT(*) FROM tournament_allowed_institutions ai
              WHERE ai.tournament_id = t.id
            ) = 1;
          CREATE INDEX IF NOT EXISTS idx_tournaments_organizing_institution
            ON tournaments (organizing_institution_id);
        `,
      },
      {
        version: 8,
        name: "persistent-tournament-workflow-position",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_workflow_state (
            tournament_id UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
            current_step SMALLINT NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 8),
            updated_by UUID NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
      },
      {
        version: 9,
        name: "immutable-tournament-roster-lock-snapshots",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_roster_lock_snapshots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL REFERENCES tournaments(id),
            version INTEGER NOT NULL,
            roster_data JSONB NOT NULL,
            locked_by UUID NOT NULL,
            locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT tournament_roster_lock_snapshot_version_unique UNIQUE (tournament_id, version),
            CONSTRAINT tournament_roster_lock_snapshot_teams_check CHECK (
              jsonb_typeof(roster_data) = 'array' AND jsonb_array_length(roster_data) > 0
            )
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_roster_lock_snapshots_latest
            ON tournament_roster_lock_snapshots (tournament_id, version DESC);
        `,
      },
      {
        version: 10,
        name: "tournament-format-details",
        sql: `
          ALTER TABLE tournament_rules
            ADD COLUMN IF NOT EXISTS round_robin_legs SMALLINT NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS max_teams_per_group INTEGER;
          ALTER TABLE tournament_rules DROP CONSTRAINT IF EXISTS tournament_rules_round_legs_check;
          ALTER TABLE tournament_rules ADD CONSTRAINT tournament_rules_round_legs_check
            CHECK (round_robin_legs IN (1, 2));
          ALTER TABLE tournament_rules DROP CONSTRAINT IF EXISTS tournament_rules_group_capacity_check;
          ALTER TABLE tournament_rules ADD CONSTRAINT tournament_rules_group_capacity_check
            CHECK (max_teams_per_group IS NULL OR max_teams_per_group >= 2);
        `,
      },
      {
        version: 11,
        name: "backfill-hybrid-group-capacity",
        sql: `
          UPDATE tournament_rules tr
          SET max_teams_per_group = LEAST(4, t.max_teams)
          FROM tournaments t
          WHERE tr.tournament_id = t.id
            AND t.competition_format = 'GROUP_AND_KNOCKOUT'
            AND tr.max_teams_per_group IS NULL
            AND t.max_teams >= 3;
        `,
      },
      {
        version: 12,
        name: "knockout-decision-and-schedule-capacity-rules",
        sql: `
          ALTER TABLE tournament_rules
            ADD COLUMN IF NOT EXISTS knockout_decision_method VARCHAR(40) NOT NULL DEFAULT 'PENALTIES_ONLY',
            ADD COLUMN IF NOT EXISTS extra_time_minutes SMALLINT NOT NULL DEFAULT 30,
            ADD COLUMN IF NOT EXISTS planned_pitch_count SMALLINT NOT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS playable_hours_per_day NUMERIC(4,1) NOT NULL DEFAULT 8;
          ALTER TABLE tournament_rules DROP CONSTRAINT IF EXISTS tournament_rules_knockout_decision_check;
          ALTER TABLE tournament_rules ADD CONSTRAINT tournament_rules_knockout_decision_check
            CHECK (knockout_decision_method IN ('PENALTIES_ONLY', 'EXTRA_TIME_THEN_PENALTIES'));
          ALTER TABLE tournament_rules DROP CONSTRAINT IF EXISTS tournament_rules_extra_time_check;
          ALTER TABLE tournament_rules ADD CONSTRAINT tournament_rules_extra_time_check
            CHECK (extra_time_minutes BETWEEN 1 AND 60);
          ALTER TABLE tournament_rules DROP CONSTRAINT IF EXISTS tournament_rules_pitch_count_check;
          ALTER TABLE tournament_rules ADD CONSTRAINT tournament_rules_pitch_count_check
            CHECK (planned_pitch_count BETWEEN 1 AND 30);
          ALTER TABLE tournament_rules DROP CONSTRAINT IF EXISTS tournament_rules_playable_hours_check;
          ALTER TABLE tournament_rules ADD CONSTRAINT tournament_rules_playable_hours_check
            CHECK (playable_hours_per_day BETWEEN 1 AND 24);
        `,
      },
      {
        version: 13,
        name: "persisted-public-live-draw-sessions",
        sql: `
          CREATE TABLE tournament_live_draw_sessions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            created_by UUID NOT NULL,
            method VARCHAR(16) NOT NULL CHECK (method IN ('RANDOM', 'SEEDED')),
            status VARCHAR(16) NOT NULL DEFAULT 'LIVE' CHECK (status IN ('LIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FINALIZED')),
            total_picks INTEGER NOT NULL CHECK (total_picks >= 2),
            revealed_count INTEGER NOT NULL DEFAULT 0 CHECK (revealed_count >= 0 AND revealed_count <= total_picks),
            hidden_plan JSONB NOT NULL CHECK (jsonb_typeof(hidden_plan) = 'object'),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            finalized_at TIMESTAMPTZ
          );
          CREATE UNIQUE INDEX idx_tournament_live_draw_active
            ON tournament_live_draw_sessions (tournament_id)
            WHERE status IN ('LIVE', 'PAUSED');
          CREATE INDEX idx_tournament_live_draw_latest
            ON tournament_live_draw_sessions (tournament_id, created_at DESC);
          CREATE TABLE tournament_live_draw_picks (
            id BIGSERIAL PRIMARY KEY,
            session_id UUID NOT NULL REFERENCES tournament_live_draw_sessions(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL CHECK (sequence > 0),
            group_index INTEGER NOT NULL CHECK (group_index >= 0),
            group_name VARCHAR(100) NOT NULL,
            team_id UUID NOT NULL,
            position INTEGER NOT NULL CHECK (position > 0),
            seed_group INTEGER,
            drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (session_id, sequence),
            UNIQUE (session_id, team_id)
          );
          CREATE INDEX idx_tournament_live_draw_picks_session
            ON tournament_live_draw_picks (session_id, sequence);
        `,
      },
      {
        version: 14,
        name: "audited-safe-team-withdrawal-before-published-draw",
        sql: `
          CREATE TABLE tournament_roster_withdrawal_adjustments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL REFERENCES tournaments(id),
            registration_id UUID NOT NULL,
            team_id UUID NOT NULL,
            actor_id UUID NOT NULL,
            reason TEXT NOT NULL,
            previous_snapshot_version INTEGER,
            snapshot_version INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (registration_id)
          );
          CREATE INDEX idx_tournament_roster_withdrawal_adjustments_tournament
            ON tournament_roster_withdrawal_adjustments (tournament_id, created_at DESC);
        `,
      },
      {
        version: 15,
        name: "competition-format-workflow-rules",
        sql: `
          ALTER TABLE tournament_rules
            ADD COLUMN IF NOT EXISTS competition_config JSONB NOT NULL DEFAULT '{}'::jsonb;
        `,
      },
      {
        version: 16,
        name: "separate-fixture-diagram-workflow-stage",
        sql: `
          ALTER TABLE tournament_workflow_state
            DROP CONSTRAINT IF EXISTS tournament_workflow_state_current_step_check;
          UPDATE tournament_workflow_state
          SET current_step = CASE current_step
            WHEN 5 THEN 6
            WHEN 6 THEN 6
            WHEN 7 THEN 7
            WHEN 8 THEN 8
            ELSE current_step
          END
          WHERE current_step BETWEEN 5 AND 8;
          ALTER TABLE tournament_workflow_state
            ADD CONSTRAINT tournament_workflow_state_current_step_check
            CHECK (current_step BETWEEN 1 AND 8);
        `,
      },
      {
        version: 17,
        name: "audited-dev-test-manual-registration-control",
        sql: `
          CREATE TABLE tournament_registration_control_audit (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL REFERENCES tournaments(id),
            actor_id UUID NOT NULL,
            action VARCHAR(20) NOT NULL CHECK (action IN ('TEST_CLOSE', 'TEST_REOPEN')),
            previous_status VARCHAR(50) NOT NULL,
            new_status VARCHAR(50) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX idx_tournament_registration_control_audit_tournament
            ON tournament_registration_control_audit (tournament_id, created_at DESC);
        `,
      },
      {
        version: 18,
        name: "approved-tournament-player-date-reservations-and-waitlist",
        sql: `
          ALTER TABLE tournament_registration_reservations ALTER COLUMN status TYPE VARCHAR(40);
          ALTER TABLE tournament_registration_reservations
            DROP CONSTRAINT IF EXISTS tournament_registration_reservations_status_check;
          ALTER TABLE tournament_registration_reservations
            ADD CONSTRAINT tournament_registration_reservations_status_check
            CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED'));
          DROP INDEX IF EXISTS idx_registration_reservations_active_team;
          CREATE UNIQUE INDEX idx_registration_reservations_active_team
            ON tournament_registration_reservations (tournament_id, team_id)
            WHERE status IN ('PENDING','APPROVED','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED');
          ALTER TABLE tournament_registration_reservations
            ADD COLUMN IF NOT EXISTS roster_player_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
            ADD COLUMN IF NOT EXISTS conflict_details JSONB NOT NULL DEFAULT '[]'::jsonb;
          CREATE TABLE IF NOT EXISTS tournament_player_participation_reservations (
            registration_id UUID NOT NULL REFERENCES tournament_registration_reservations(registration_id) ON DELETE CASCADE,
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            player_id UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (registration_id, player_id)
          );
          CREATE INDEX IF NOT EXISTS idx_player_participation_reservations_player
            ON tournament_player_participation_reservations (player_id, tournament_id);
          CREATE INDEX IF NOT EXISTS idx_player_participation_reservations_tournament
            ON tournament_player_participation_reservations (tournament_id, registration_id);
        `,
      },
      {
        version: 19,
        name: "confirmed-player-invitation-date-claims",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_player_participation_claims (
            invitation_id UUID PRIMARY KEY,
            tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
            team_id UUID NOT NULL,
            player_id UUID NOT NULL,
            state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RELEASED')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            released_at TIMESTAMPTZ,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_player_participation_claims_player_state
            ON tournament_player_participation_claims (player_id, state, tournament_id);
          CREATE INDEX IF NOT EXISTS idx_player_participation_claims_team_tournament
            ON tournament_player_participation_claims (team_id, tournament_id, state);
        `,
      },
      {
        version: 20,
        name: "tournament-minimum-goalkeepers",
        sql: `
          ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS min_goalkeepers INTEGER NOT NULL DEFAULT 1;
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_football_format_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_football_format_check CHECK (football_format IN (5, 7, 11));
          ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_min_goalkeepers_check;
          ALTER TABLE tournaments ADD CONSTRAINT tournaments_min_goalkeepers_check
            CHECK (min_goalkeepers >= 0 AND min_goalkeepers <= max_players_per_team);
        `,
      },
      {
        version: 21,
        name: "development-draw-workspace-test-config",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_draw_test_configs (
            tournament_id UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
            config JSONB NOT NULL,
            updated_by UUID NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `,
      },
      {
        version: 22,
        name: "server-managed-live-draw-schedule-and-idempotency",
        sql: `
          ALTER TABLE tournament_live_draw_sessions
            ADD COLUMN IF NOT EXISTS event_name VARCHAR(200) NOT NULL DEFAULT 'Buổi bốc thăm',
            ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            ADD COLUMN IF NOT EXISTS time_zone VARCHAR(100) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
            ADD COLUMN IF NOT EXISTS announcement TEXT NOT NULL DEFAULT '';
          ALTER TABLE tournament_live_draw_sessions DROP CONSTRAINT IF EXISTS tournament_live_draw_sessions_status_check;
          ALTER TABLE tournament_live_draw_sessions ADD CONSTRAINT tournament_live_draw_sessions_status_check
            CHECK (status IN ('SCHEDULED','POSTPONED','LIVE','PAUSED','COMPLETED','CANCELLED','FINALIZED'));
          DROP INDEX IF EXISTS idx_tournament_live_draw_active;
          CREATE UNIQUE INDEX idx_tournament_live_draw_active
            ON tournament_live_draw_sessions (tournament_id)
            WHERE status IN ('SCHEDULED','POSTPONED','LIVE','PAUSED');
          ALTER TABLE tournament_live_draw_picks
            ADD COLUMN IF NOT EXISTS request_key VARCHAR(120);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_live_draw_pick_request_key
            ON tournament_live_draw_picks (session_id, request_key)
            WHERE request_key IS NOT NULL;
          CREATE TABLE IF NOT EXISTS tournament_live_draw_events (
            id BIGSERIAL PRIMARY KEY,
            session_id UUID NOT NULL REFERENCES tournament_live_draw_sessions(id) ON DELETE CASCADE,
            actor_id UUID NOT NULL,
            event_type VARCHAR(24) NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            sequence INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_live_draw_events_history
            ON tournament_live_draw_events (session_id, id DESC);
        `,
      },
      {
        version: 23,
        name: "draw-method-locks-location-and-cancellation-audit",
        sql: `
          ALTER TABLE tournament_live_draw_sessions
            ADD COLUMN IF NOT EXISTS location VARCHAR(300) NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;
          CREATE INDEX IF NOT EXISTS idx_tournament_draw_versions_method_status
            ON tournament_draw_versions (tournament_id, method, status, version DESC);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_draw_one_draft_per_method
            ON tournament_draw_versions (tournament_id, method) WHERE status='DRAFT';
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_draw_one_published_result
            ON tournament_draw_versions (tournament_id) WHERE status='PUBLISHED';
        `,
      },
      {
        version: 24,
        name: "isolated-development-draw-workflow-snapshots",
        sql: `
          CREATE TABLE IF NOT EXISTS tournament_draw_test_snapshots (
            tournament_id UUID PRIMARY KEY REFERENCES tournaments(id) ON DELETE CASCADE,
            state JSONB NOT NULL,
            revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
            updated_by UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_draw_test_snapshots_updated
            ON tournament_draw_test_snapshots (updated_at DESC);
        `,
      },
      {
        version: 25,
        name: "unified-pending-registration-review-queue",
        sql: `
          UPDATE tournament_registration_reservations
          SET status='PENDING', updated_at=NOW()
          WHERE status='WAITLIST';
        `,
      },
      { version: 26, name: "versioned-match-operation-rules", sql: matchOperationRulesSql },
      { version: 27, name: "audited-legacy-match-regulation-basis", sql: matchOperationRulesBaseSql },
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
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log("[tournament-service] database migrations are current");
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error("[tournament-service] migration failed", error);
    process.exitCode = 1;
  });
}

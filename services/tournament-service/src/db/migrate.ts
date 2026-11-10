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

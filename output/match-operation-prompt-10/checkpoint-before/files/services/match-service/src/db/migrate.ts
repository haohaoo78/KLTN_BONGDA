import { Pool } from "pg";
import { schemaSql } from "./schema";
import { schemaSql as schedulingSchemaSql } from "./schedulingSchema";
import { schemaSql as disciplineSchemaSql } from "./disciplineSchema";
import { applyRefereeTeamMigration } from "./refereeTeamMigration";
import { applyRefereeConfigurationMigration } from "./refereeConfigurationMigration";
import { applyRefereeAssignmentDraftMigration } from "./refereeAssignmentDraftMigration";
import { applyRefereePublicationMigration } from "./refereePublicationMigration";
import { applyRefereePublicationVoidAuditMigration } from "./refereePublicationVoidAuditMigration";
import { applyMatchOperationRulesMigration } from "./matchOperationRulesMigration";
import { applyMatchSquadMigration } from "./matchSquadMigration";
import { applyMatchClockTimingMigration } from "./matchClockTimingMigration";
import {applyMatchEventWorkflowMigration} from './matchEventWorkflowMigration';
import {applyMatchShootoutMigration} from './matchShootoutMigration';
import { applyMatchDemoTimeMigration } from "./matchDemoTimeMigration";
import { applyMatchReportWorkflowMigration } from "./matchReportWorkflowMigration";
import { applyCompetitionProjectionMigration, applyDisciplineProjectionMigration } from "./competitionProjectionMigration";

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
  await applyResultCorrectionMigration(matchDatabaseUrl);
  await applyResultCorrectionScopeMigration(matchDatabaseUrl);
  await applyMatchApprovalMigration(matchDatabaseUrl);
  await applyMatchEventAuditMigration(matchDatabaseUrl);
  await applyMatchEventDisciplineOutboxMigration(matchDatabaseUrl);
  await applyKnockoutBracketMigration(matchDatabaseUrl);
  await applyHybridPlayoffMigration(matchDatabaseUrl);
  await applyGroupLotDrawMigration(matchDatabaseUrl);
  await applyForfeitDecisionMigration(matchDatabaseUrl);
  await applyPrecreatedBracketMatchMigration(matchDatabaseUrl);
  await applyMatchClockMigration(matchDatabaseUrl);
  await applyMatchReportSnapshotMigration(matchDatabaseUrl);
  await applyMatchRealtimeEventMigration(matchDatabaseUrl);
  await applyHybridPlayoffPlaceholderMigration(matchDatabaseUrl);
  await applyFixturePublicationMigration(matchDatabaseUrl);
  await applyResultCorrectionCascadeAuditMigration(matchDatabaseUrl);
      await applyKnockoutThirdPlaceMigration(matchDatabaseUrl);
  await applyFixtureStructureMetadataMigration(matchDatabaseUrl);
  await applyMatchOperationRulesMigration(matchDatabaseUrl);
  await applyMatchSquadMigration(matchDatabaseUrl);
  await applyMatchClockTimingMigration(matchDatabaseUrl);
  await applyMatchEventWorkflowMigration(matchDatabaseUrl);
  await applyMatchShootoutMigration(matchDatabaseUrl);
  await applyMatchDemoTimeMigration(matchDatabaseUrl);
  await applyMatchReportWorkflowMigration(matchDatabaseUrl);
  await applyCompetitionProjectionMigration(matchDatabaseUrl);
  await applyBaselineMigration(schedulingDatabaseUrl, schedulingSchemaSql, "scheduling");
  await applySchedulingRefereeCrewMigration(schedulingDatabaseUrl);
  await applyScheduleChangeHistoryMigration(schedulingDatabaseUrl);
  await applySchedulingWorkflowTestSnapshotMigration(schedulingDatabaseUrl);
  await applyScheduleResourcePresetMigration(schedulingDatabaseUrl);
  await applyOfficialScheduleWorkflowMigration(schedulingDatabaseUrl);
  await applyOfficialScheduleEntryMetadataMigration(schedulingDatabaseUrl);
  await applyRefereeTeamMigration(schedulingDatabaseUrl);
  await applyRefereeConfigurationMigration(schedulingDatabaseUrl);
  await applyRefereeAssignmentDraftMigration(schedulingDatabaseUrl);
  await applyRefereePublicationMigration(schedulingDatabaseUrl);
  await applyRefereePublicationVoidAuditMigration(schedulingDatabaseUrl);
  await applyBaselineMigration(disciplineDatabaseUrl, disciplineSchemaSql, "discipline");
  await applyDisciplineCardSourceMigration(disciplineDatabaseUrl);
  await applyComplaintAppealMigration(disciplineDatabaseUrl);
  await applyMatchCountSuspensionMigration(disciplineDatabaseUrl);
  await applyDisciplinaryDecisionSuspensionLinkMigration(disciplineDatabaseUrl);
  await applyDisciplineProjectionMigration(disciplineDatabaseUrl);
}

/** Preserve organizer notes and the selected time-window identifier in official drafts. */
async function applyOfficialScheduleEntryMetadataMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1008");
      if (!applied.rowCount) {
        await client.query("ALTER TABLE schedules ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS slot_id TEXT");
        await client.query("INSERT INTO sfl_schema_migrations(version,name) VALUES(1008,$1)", ["official-schedule-entry-notes-and-time-slot"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

/** Store reusable BTC scheduling resources separately from a tournament schedule snapshot. */
async function applyScheduleResourcePresetMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 1006");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS match_schedule_resource_presets (
            manager_user_id UUID PRIMARY KEY,
            state JSONB NOT NULL,
            version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_match_schedule_resource_presets_updated
            ON match_schedule_resource_presets (updated_at DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version,name) VALUES(1006,$1)", ["manager-scoped-reusable-schedule-resource-presets"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

/** Add official per-tournament scheduling settings and an independent schedule lock flag. */
async function applyOfficialScheduleWorkflowMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1007");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE schedules
            ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
          CREATE TABLE IF NOT EXISTS tournament_schedule_resources (
            tournament_id UUID PRIMARY KEY,
            resources JSONB NOT NULL,
            revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
            updated_by UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_tournament_schedule_resources_updated
            ON tournament_schedule_resources (updated_at DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version,name) VALUES(1007,$1)", ["official-tournament-scheduling-resources-and-lock-state"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

/** Isolated server-side test snapshots; this table is only created in the scheduling DB. */
async function applySchedulingWorkflowTestSnapshotMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version=1005");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS match_schedule_test_snapshots (
            tournament_id UUID PRIMARY KEY,
            diagram_version TEXT NOT NULL,
            state JSONB NOT NULL,
            revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
            updated_by UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_match_schedule_test_snapshots_updated
            ON match_schedule_test_snapshots (updated_at DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version,name) VALUES(1005,$1)", ["isolated-development-schedule-test-snapshots"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyMatchCountSuspensionMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 4");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE suspensions
            ADD COLUMN IF NOT EXISTS matches_suspended INTEGER;
          DO $$ BEGIN
            ALTER TABLE suspensions
              ADD CONSTRAINT suspensions_matches_suspended_check
              CHECK (matches_suspended IS NULL OR matches_suspended > 0);
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
          CREATE INDEX IF NOT EXISTS idx_cards_yellow_accumulation
            ON cards (player_id, tournament_id, issued_at)
            WHERE card_type = 'YELLOW' AND voided_at IS NULL;
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (4, $1)",
          ["discipline-match-count-suspensions"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyDisciplinaryDecisionSuspensionLinkMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 5");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE disciplinary_decisions ADD COLUMN IF NOT EXISTS suspension_id UUID;
          DO $$ BEGIN
            ALTER TABLE disciplinary_decisions
              ADD CONSTRAINT disciplinary_decisions_suspension_fk
              FOREIGN KEY (suspension_id) REFERENCES suspensions(id) ON DELETE SET NULL;
          EXCEPTION WHEN duplicate_object THEN NULL;
          END $$;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_disciplinary_decisions_suspension_unique
            ON disciplinary_decisions (suspension_id) WHERE suspension_id IS NOT NULL;
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (5, $1)",
          ["link-disciplinary-decisions-to-suspensions"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyPrecreatedBracketMatchMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 13");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE matches ALTER COLUMN home_team_id DROP NOT NULL;
          ALTER TABLE matches ALTER COLUMN away_team_id DROP NOT NULL;
          ALTER TABLE matches DROP CONSTRAINT IF EXISTS matches_teams_check;
          ALTER TABLE matches ADD CONSTRAINT matches_teams_check
            CHECK (home_team_id IS NULL OR away_team_id IS NULL OR home_team_id <> away_team_id);

          WITH inserted_matches AS (
            INSERT INTO matches (tournament_id, home_team_id, away_team_id, round, status, draw_version_id, fixture_key)
            SELECT slot.tournament_id, slot.home_team_id, slot.away_team_id,
                   'Vòng ' || slot.round_number || ' · Trận ' || slot.position,
                   'UNSCHEDULED', slot.draw_version_id,
                   'knockout:' || slot.round_number || ':' || slot.position
            FROM match_bracket_slots slot
            WHERE slot.match_id IS NULL AND slot.status IN ('WAITING', 'READY')
            ON CONFLICT (tournament_id, fixture_key) WHERE fixture_key IS NOT NULL
              DO UPDATE SET updated_at = matches.updated_at
            RETURNING id, tournament_id, draw_version_id, fixture_key
          )
          UPDATE match_bracket_slots slot
          SET match_id = inserted.id, updated_at = NOW()
          FROM inserted_matches inserted
          WHERE slot.match_id IS NULL
            AND inserted.tournament_id = slot.tournament_id
            AND inserted.draw_version_id = slot.draw_version_id
            AND inserted.fixture_key = 'knockout:' || slot.round_number || ':' || slot.position;
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (13, $1)", ["precreated-knockout-fixtures-for-scheduling"]);
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

async function applyComplaintAppealMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      // Use an isolated high version because Match and Discipline can share DATABASE_URL in development.
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 1003");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS complaint_appeals (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE RESTRICT,
            submitted_by UUID NOT NULL,
            description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 10 AND 4000),
            evidence TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_by UUID,
            reviewed_at TIMESTAMPTZ,
            decision_reason TEXT,
            original_decision JSONB,
            CONSTRAINT complaint_appeals_one_per_complaint UNIQUE (complaint_id),
            CONSTRAINT complaint_appeals_review_state CHECK (
              (status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL)
              OR (status IN ('APPROVED', 'REJECTED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
            ),
            CONSTRAINT complaint_appeals_rejection_reason CHECK (status <> 'REJECTED' OR length(trim(coalesce(decision_reason, ''))) > 0)
          );
          CREATE INDEX IF NOT EXISTS idx_complaint_appeals_status_submitted
            ON complaint_appeals (status, submitted_at DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (1003, $1)", ["discipline-complaint-appeal-workflow"]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyForfeitDecisionMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 12");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS match_forfeit_decisions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            match_id UUID NOT NULL UNIQUE REFERENCES matches(id) ON DELETE RESTRICT,
            tournament_id UUID NOT NULL,
            forfeiting_team_id UUID NOT NULL,
            winner_team_id UUID NOT NULL,
            reason TEXT NOT NULL,
            policy VARCHAR(40) NOT NULL CHECK (policy IN ('WALKOVER', 'ORGANIZER_DECISION')),
            home_score INTEGER NOT NULL CHECK (home_score >= 0),
            away_score INTEGER NOT NULL CHECK (away_score >= 0),
            decided_by UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (winner_team_id <> forfeiting_team_id),
            CHECK (home_score <> away_score)
          );
          CREATE INDEX IF NOT EXISTS idx_match_forfeit_tournament_created
            ON match_forfeit_decisions (tournament_id, created_at DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (12, $1)", ["audited-forfeit-decisions"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyHybridPlayoffMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 8");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id UUID;
          UPDATE matches
            SET group_id = split_part(fixture_key, ':', 1)::UUID
            WHERE group_id IS NULL
              AND fixture_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:';
          ALTER TABLE match_fixture_generations ADD COLUMN IF NOT EXISTS stage VARCHAR(20) NOT NULL DEFAULT 'GROUP';
          ALTER TABLE match_fixture_generations DROP CONSTRAINT IF EXISTS match_fixture_generations_draw_version_id_key;
          UPDATE match_fixture_generations generation SET stage = 'KNOCKOUT'
            WHERE EXISTS (SELECT 1 FROM match_bracket_slots slot
              WHERE slot.draw_version_id = generation.draw_version_id);
          ALTER TABLE match_fixture_generations DROP CONSTRAINT IF EXISTS match_fixture_generations_stage_check;
          ALTER TABLE match_fixture_generations ADD CONSTRAINT match_fixture_generations_stage_check
            CHECK (stage IN ('GROUP', 'KNOCKOUT'));
          CREATE UNIQUE INDEX IF NOT EXISTS idx_match_fixture_generation_stage
            ON match_fixture_generations (draw_version_id, stage);
          CREATE TABLE IF NOT EXISTS match_knockout_qualifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            draw_version_id UUID NOT NULL,
            team_id UUID NOT NULL,
            group_id UUID NOT NULL,
            group_rank SMALLINT NOT NULL CHECK (group_rank > 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT match_knockout_qualification_unique UNIQUE (draw_version_id, team_id),
            CONSTRAINT match_knockout_group_rank_unique UNIQUE (draw_version_id, group_id, group_rank)
          );
          CREATE INDEX IF NOT EXISTS idx_match_knockout_qualifications_tournament
            ON match_knockout_qualifications (tournament_id, draw_version_id, group_id, group_rank);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (8, $1)", ["hybrid-group-knockout-qualification"]);
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

async function applyGroupLotDrawMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 9");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS match_group_lot_draws (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            draw_version_id UUID NOT NULL,
            group_id UUID NOT NULL,
            tie_key TEXT NOT NULL,
            tied_team_ids UUID[] NOT NULL,
            drawn_order UUID[] NOT NULL,
            witness_name TEXT NOT NULL CHECK (length(trim(witness_name)) BETWEEN 2 AND 120),
            reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
            drawn_by UUID NOT NULL,
            drawn_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT match_group_lot_draw_unique UNIQUE (draw_version_id, group_id, tie_key)
          );
          CREATE INDEX IF NOT EXISTS idx_match_group_lot_draws_tournament
            ON match_group_lot_draws (tournament_id, draw_version_id, group_id, drawn_at);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (9, $1)", ["auditable-hybrid-group-lot-draws"]);
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

async function applyKnockoutBracketMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 7");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS match_bracket_slots (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tournament_id UUID NOT NULL,
            draw_version_id UUID NOT NULL,
            round_number SMALLINT NOT NULL CHECK (round_number > 0),
            position SMALLINT NOT NULL CHECK (position > 0),
            home_team_id UUID,
            away_team_id UUID,
            home_source_slot_id UUID REFERENCES match_bracket_slots(id) ON DELETE RESTRICT,
            away_source_slot_id UUID REFERENCES match_bracket_slots(id) ON DELETE RESTRICT,
            home_resolved BOOLEAN NOT NULL DEFAULT FALSE,
            away_resolved BOOLEAN NOT NULL DEFAULT FALSE,
            winner_team_id UUID,
            match_id UUID UNIQUE REFERENCES matches(id) ON DELETE RESTRICT,
            status VARCHAR(20) NOT NULL CHECK (status IN ('WAITING', 'READY', 'BYE', 'COMPLETED')),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT match_bracket_slot_unique UNIQUE (draw_version_id, round_number, position),
            CONSTRAINT match_bracket_different_teams CHECK (home_team_id IS NULL OR away_team_id IS NULL OR home_team_id <> away_team_id)
          );
          CREATE INDEX IF NOT EXISTS idx_match_bracket_tournament_round
            ON match_bracket_slots (tournament_id, draw_version_id, round_number, position);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (7, $1)", ["knockout-bracket-slots"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyMatchEventDisciplineOutboxMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 6");
      if (applied.rowCount === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS match_event_discipline_outbox (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id UUID NOT NULL,
            action VARCHAR(20) NOT NULL CHECK (action IN ('ISSUE_CARD', 'VOID_CARD')),
            payload JSONB NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            claimed_until TIMESTAMPTZ,
            processed_at TIMESTAMPTZ,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT match_event_discipline_outbox_event_action_unique UNIQUE (event_id, action)
          );
          CREATE INDEX IF NOT EXISTS idx_match_event_discipline_outbox_pending
            ON match_event_discipline_outbox (available_at, created_at)
            WHERE processed_at IS NULL;
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (6, $1)", ["match-event-discipline-outbox"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyDisciplineCardSourceMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 2");
      if (applied.rowCount === 0) {
        await client.query(`
          ALTER TABLE cards ADD COLUMN IF NOT EXISTS source_event_id UUID;
          ALTER TABLE cards ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
          ALTER TABLE cards ADD COLUMN IF NOT EXISTS voided_by UUID;
          ALTER TABLE cards ADD COLUMN IF NOT EXISTS void_reason TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_source_event_unique
            ON cards (source_event_id);
          ALTER TABLE suspensions ADD COLUMN IF NOT EXISTS source_card_id UUID REFERENCES cards(id) ON DELETE SET NULL;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_suspensions_source_card_unique
            ON suspensions (source_card_id);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (2, $1)", ["discipline-card-event-source-and-reversal"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyMatchEventAuditMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 5");
      if (applied.rowCount === 0) {
        await client.query(`
          ALTER TABLE match_events ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
          ALTER TABLE match_events ADD COLUMN IF NOT EXISTS voided_by UUID;
          ALTER TABLE match_events ADD COLUMN IF NOT EXISTS void_reason TEXT;
          CREATE TABLE IF NOT EXISTS match_event_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            event_id UUID NOT NULL,
            match_id UUID NOT NULL,
            action VARCHAR(20) NOT NULL CHECK (action IN ('CREATED', 'VOIDED')),
            event_snapshot JSONB NOT NULL,
            actor_id UUID NOT NULL,
            reason TEXT,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_match_event_history_event_date
            ON match_event_history (event_id, occurred_at DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (5, $1)", ["match-event-audit-and-voiding"]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function applySchedulingRefereeCrewMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 2");
      if (applied.rowCount === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS schedule_referee_assignments (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
            referee_id UUID NOT NULL,
            position VARCHAR(60) NOT NULL,
            is_final_authority BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            assigned_by UUID NOT NULL,
            assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT schedule_referee_position_check CHECK (position ~ '^[A-Z][A-Z0-9_]{1,59}$')
          );
          CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_referee_active_person
            ON schedule_referee_assignments (schedule_id, referee_id) WHERE is_active = TRUE;
          CREATE UNIQUE INDEX IF NOT EXISTS idx_schedule_referee_final_authority
            ON schedule_referee_assignments (schedule_id) WHERE is_active = TRUE AND is_final_authority = TRUE;
          CREATE INDEX IF NOT EXISTS idx_schedule_referee_person
            ON schedule_referee_assignments (referee_id, schedule_id) WHERE is_active = TRUE;
          CREATE TABLE IF NOT EXISTS schedule_referee_assignment_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
            before_assignments JSONB NOT NULL,
            after_assignments JSONB NOT NULL,
            changed_by UUID NOT NULL,
            reason TEXT,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_schedule_referee_history_schedule_date
            ON schedule_referee_assignment_history (schedule_id, changed_at DESC);
          INSERT INTO schedule_referee_assignments (schedule_id, referee_id, position, is_final_authority, assigned_by)
          SELECT id, referee_id, 'REFEREE', TRUE, created_by FROM schedules WHERE referee_id IS NOT NULL
          ON CONFLICT DO NOTHING;
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (2, $1)",
          ["per-match-referee-crew-and-assignment-history"],
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

async function applyScheduleChangeHistoryMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 3");
      if (applied.rowCount === 0) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS schedule_change_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
            before_state JSONB NOT NULL,
            after_state JSONB NOT NULL,
            changed_by UUID NOT NULL,
            reason TEXT,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_schedule_change_history_schedule_date
            ON schedule_change_history (schedule_id, changed_at DESC);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (3, $1)",
          ["published-schedule-change-audit"],
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

async function applyResultCorrectionMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 10");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE match_result_correction_requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            match_id UUID NOT NULL REFERENCES matches(id) ON DELETE RESTRICT,
            requested_by UUID NOT NULL,
            original_result JSONB NOT NULL,
            proposed_result JSONB NOT NULL,
            reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 2000),
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
            reviewed_by UUID,
            reviewed_at TIMESTAMPTZ,
            review_reason TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX idx_result_correction_match_created
            ON match_result_correction_requests (match_id, created_at DESC);
          CREATE UNIQUE INDEX idx_result_correction_one_pending
            ON match_result_correction_requests (match_id) WHERE status = 'PENDING';
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (10, $1)",
          ["audited-match-result-correction-requests"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyResultCorrectionScopeMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 11");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE match_result_correction_requests
            ADD COLUMN IF NOT EXISTS tournament_id UUID;
          UPDATE match_result_correction_requests request
            SET tournament_id = match.tournament_id
            FROM matches match
            WHERE request.match_id = match.id AND request.tournament_id IS NULL;
          ALTER TABLE match_result_correction_requests
            ALTER COLUMN tournament_id SET NOT NULL;
          CREATE INDEX IF NOT EXISTS idx_result_correction_tournament_status
            ON match_result_correction_requests (tournament_id, status, created_at DESC);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (11, $1)",
          ["scope-result-correction-requests-by-tournament"],
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

async function applyMatchClockMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 14");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE match_clock_states (
            match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
            phase VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED'
              CHECK (phase IN ('NOT_STARTED','FIRST_HALF','HALF_TIME','SECOND_HALF','REGULATION_COMPLETE',
                'EXTRA_TIME_FIRST_HALF','EXTRA_TIME_HALF_TIME','EXTRA_TIME_SECOND_HALF','EXTRA_TIME_COMPLETE','PENALTIES','ENDED')),
            elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
            total_elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (total_elapsed_seconds >= 0),
            is_running BOOLEAN NOT NULL DEFAULT FALSE,
            started_at TIMESTAMPTZ,
            updated_by UUID,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
            CONSTRAINT match_clock_running_started_check CHECK ((is_running AND started_at IS NOT NULL) OR (NOT is_running AND started_at IS NULL))
          );
          INSERT INTO match_clock_states (match_id, phase, elapsed_seconds, total_elapsed_seconds, is_running, started_at, updated_at, version)
          SELECT id, 'FIRST_HALF', 0, 0, TRUE, NOW(), NOW(), 0
          FROM matches WHERE status = 'IN_PROGRESS'
          ON CONFLICT (match_id) DO NOTHING;
          CREATE INDEX idx_match_clock_running ON match_clock_states (is_running, updated_at DESC);
        `);
        await client.query("INSERT INTO sfl_schema_migrations (version, name) VALUES (14, $1)", ["persisted-match-clock-and-period-state"]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyMatchReportSnapshotMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 15");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE match_reports
            ADD COLUMN IF NOT EXISTS submission_snapshots JSONB NOT NULL DEFAULT '[]'::jsonb;
          ALTER TABLE match_reports
            ADD CONSTRAINT match_reports_submission_snapshots_array
            CHECK (jsonb_typeof(submission_snapshots) = 'array');
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (15, $1)",
          ["append-match-report-submission-snapshots"],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyMatchRealtimeEventMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 16");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE match_realtime_events (
            id BIGSERIAL PRIMARY KEY,
            match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
            event_type VARCHAR(64) NOT NULL,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX idx_match_realtime_events_match_id
            ON match_realtime_events (match_id, id);
          CREATE INDEX idx_match_realtime_events_occurred_at
            ON match_realtime_events (occurred_at);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (16, $1)",
          ["transactional-match-realtime-event-log"],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyHybridPlayoffPlaceholderMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 17");
      if (!applied.rowCount) {
        await client.query(`
          CREATE TABLE match_bracket_qualification_sources (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            slot_id UUID NOT NULL REFERENCES match_bracket_slots(id) ON DELETE CASCADE,
            draw_version_id UUID NOT NULL,
            side VARCHAR(4) NOT NULL CHECK (side IN ('HOME', 'AWAY')),
            group_id UUID NOT NULL,
            group_rank SMALLINT NOT NULL CHECK (group_rank > 0),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT match_bracket_qualification_source_side_unique UNIQUE (slot_id, side),
            CONSTRAINT match_bracket_qualification_seed_unique UNIQUE (draw_version_id, group_id, group_rank)
          );
          CREATE INDEX idx_match_bracket_qualification_slot
            ON match_bracket_qualification_sources (draw_version_id, slot_id);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (17, $1)",
          ["persist-hybrid-playoff-placeholder-sources"],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyFixturePublicationMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 18");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE match_fixture_generations
            ADD COLUMN IF NOT EXISTS publication_status VARCHAR(20) NOT NULL DEFAULT 'PUBLISHED',
            ADD COLUMN IF NOT EXISTS published_by UUID,
            ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
          ALTER TABLE match_fixture_generations DROP CONSTRAINT IF EXISTS match_fixture_generations_publication_status_check;
          ALTER TABLE match_fixture_generations ADD CONSTRAINT match_fixture_generations_publication_status_check
            CHECK (publication_status IN ('DRAFT', 'PUBLISHED'));
          CREATE INDEX IF NOT EXISTS idx_match_fixture_generation_publication
            ON match_fixture_generations (tournament_id, publication_status, created_at DESC);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (18, $1)",
          ["fixture-draft-publication-workflow"],
        );
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyResultCorrectionCascadeAuditMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 19");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE match_result_correction_requests
            ADD COLUMN IF NOT EXISTS cascade_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (19, $1)",
          ["audited-knockout-result-correction-cascade"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

async function applyKnockoutThirdPlaceMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 20");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE match_bracket_slots
            ADD COLUMN IF NOT EXISTS slot_type VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
            ADD COLUMN IF NOT EXISTS home_source_outcome VARCHAR(10) NOT NULL DEFAULT 'WINNER',
            ADD COLUMN IF NOT EXISTS away_source_outcome VARCHAR(10) NOT NULL DEFAULT 'WINNER';
          ALTER TABLE match_bracket_slots
            ADD CONSTRAINT match_bracket_slot_type_check CHECK (slot_type IN ('STANDARD', 'THIRD_PLACE')),
            ADD CONSTRAINT match_bracket_home_source_outcome_check CHECK (home_source_outcome IN ('WINNER', 'LOSER')),
            ADD CONSTRAINT match_bracket_away_source_outcome_check CHECK (away_source_outcome IN ('WINNER', 'LOSER'));
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (20, $1)",
          ["knockout-third-place-loser-sources"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

/** Add normalized fixture metadata without rewriting or deleting match history. */
async function applyFixtureStructureMetadataMigration(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database())::bigint)");
      const applied = await client.query("SELECT 1 FROM sfl_schema_migrations WHERE version = 21");
      if (!applied.rowCount) {
        await client.query(`
          ALTER TABLE matches
            ADD COLUMN IF NOT EXISTS stage VARCHAR(20),
            ADD COLUMN IF NOT EXISTS round_number SMALLINT,
            ADD COLUMN IF NOT EXISTS leg SMALLINT;
          ALTER TABLE match_fixture_generations
            ADD COLUMN IF NOT EXISTS regulation_version INTEGER;
          UPDATE matches m SET stage='GROUP'
            WHERE m.stage IS NULL AND m.group_id IS NOT NULL AND m.draw_version_id IS NOT NULL;
          UPDATE matches m SET stage='KNOCKOUT', round_number=slot.round_number, leg=1
            FROM match_bracket_slots slot
            WHERE slot.match_id=m.id AND m.stage IS NULL;
          UPDATE matches SET
            leg = CASE WHEN fixture_key ~ '^[0-9a-fA-F-]{36}:[12]:'
              THEN split_part(fixture_key, ':', 2)::SMALLINT ELSE 1 END,
            round_number = CASE WHEN fixture_key ~ '^[0-9a-fA-F-]{36}:[12]:[0-9]+:'
              THEN split_part(fixture_key, ':', 3)::SMALLINT END
            WHERE stage='GROUP' AND fixture_key IS NOT NULL;
          DO $$ BEGIN
            ALTER TABLE matches ADD CONSTRAINT matches_fixture_stage_check
              CHECK (stage IS NULL OR stage IN ('GROUP','KNOCKOUT'));
          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
          DO $$ BEGIN
            ALTER TABLE matches ADD CONSTRAINT matches_fixture_round_number_check
              CHECK (round_number IS NULL OR round_number > 0);
          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
          DO $$ BEGIN
            ALTER TABLE matches ADD CONSTRAINT matches_fixture_leg_check
              CHECK (leg IS NULL OR leg IN (1,2));
          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
          CREATE INDEX IF NOT EXISTS idx_matches_tournament_draw_stage_round
            ON matches (tournament_id, draw_version_id, stage, group_id, leg, round_number);
        `);
        await client.query(
          "INSERT INTO sfl_schema_migrations (version, name) VALUES (21, $1)",
          ["normalized-fixture-stage-round-leg-and-regulation-version"],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally { await pool.end(); }
}

if (require.main === module) {
  runMigrations().catch((error: unknown) => {
    console.error("[match-service] migration failed", error);
    process.exitCode = 1;
  });
}

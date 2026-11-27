import {getEffectiveMatchRules,assertResultRulePolicy} from '../services/matchOperationRulesService';
import {assertRecordedOutcome} from './matchOutcomeRepository';
import type {
  Match,
  MatchCreateInput,
  MatchUpdateInput,
  MatchResult,
  MatchResultCreateInput,
  MatchResultCorrectionRequest,
  Standing,
  StandingUpdateInput,
  GeneratedFixtureInput,
  FixtureGenerationResult,
} from "../models/match";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import { freezeMatchClock } from "./matchClockRepository";
import type { PoolClient } from "pg";
import { createKnockoutBracket, createThirdPlaceBracketDefinition } from "../services/knockoutBracket";
import type { GroupLotDrawResolution } from "../services/hybridQualification";
import { publishMatchUpdate } from "../realtime/matchRealtime";

export type AuditableGroupLotDraw = GroupLotDrawResolution & { groupId: string };
export type GroupLotDrawAudit = AuditableGroupLotDraw & {
  tournamentId: string;
  drawVersionId: string;
  drawnBy: string;
  drawnAt: string;
};

export async function listGroupLotDrawAudits(tournamentId: string, drawVersionId: string): Promise<GroupLotDrawAudit[]> {
  const result = await getPool().query<{
    tournament_id: string; draw_version_id: string; group_id: string; tied_team_ids: string[]; drawn_order: string[];
    witness_name: string; reason: string; drawn_by: string; drawn_at: Date;
  }>(
    `SELECT tournament_id, draw_version_id, group_id, tied_team_ids, drawn_order, witness_name, reason, drawn_by, drawn_at
     FROM match_group_lot_draws WHERE tournament_id=$1 AND draw_version_id=$2 ORDER BY drawn_at, group_id, tie_key`,
    [tournamentId, drawVersionId],
  );
  return result.rows.map((row) => ({
    tournamentId: row.tournament_id,
    drawVersionId: row.draw_version_id,
    groupId: row.group_id,
    tiedTeamIds: row.tied_team_ids,
    drawnOrder: row.drawn_order,
    witnessName: row.witness_name,
    reason: row.reason,
    drawnBy: row.drawn_by,
    drawnAt: row.drawn_at.toISOString(),
  }));
}

export async function recalculateStandings(client: PoolClient, tournamentId: string): Promise<void> {
  await client.query("DELETE FROM standings WHERE tournament_id = $1", [tournamentId]);
  await client.query(
    `WITH match_scores AS (
         SELECT tournament_id, home_team_id, away_team_id, result.home_score+COALESCE(result.home_extra_time_score,0) AS home_score, result.away_score+COALESCE(result.away_extra_time_score,0) AS away_score
       FROM matches
       JOIN match_results AS result ON result.match_id = matches.id
         WHERE tournament_id = $1 AND matches.status IN ('FINISHED', 'VERIFIED', 'LOCKED')
           AND result.status = 'APPROVED'
           AND NOT EXISTS (SELECT 1 FROM match_bracket_slots bracket WHERE bracket.match_id = matches.id)
     ),
     team_results AS (
       SELECT tournament_id, home_team_id AS team_id, home_score AS goals_for,
              away_score AS goals_against
       FROM match_scores
       UNION ALL
       SELECT tournament_id, away_team_id AS team_id, away_score AS goals_for,
              home_score AS goals_against
       FROM match_scores
     ),
     totals AS (
       SELECT tournament_id, team_id, COUNT(*)::INTEGER AS played,
              COUNT(*) FILTER (WHERE goals_for > goals_against)::INTEGER AS won,
              COUNT(*) FILTER (WHERE goals_for = goals_against)::INTEGER AS drawn,
              COUNT(*) FILTER (WHERE goals_for < goals_against)::INTEGER AS lost,
              SUM(goals_for)::INTEGER AS goals_for,
              SUM(goals_against)::INTEGER AS goals_against,
              SUM(CASE WHEN goals_for > goals_against THEN 3
                       WHEN goals_for = goals_against THEN 1 ELSE 0 END)::INTEGER AS points
       FROM team_results
       GROUP BY tournament_id, team_id
     )
     INSERT INTO standings (
       tournament_id, team_id, played, won, drawn, lost, goals_for, goals_against,
       goal_difference, points
     )
     SELECT tournament_id, team_id, played, won, drawn, lost, goals_for, goals_against,
            goals_for - goals_against, points
     FROM totals`,
    [tournamentId],
  );
}

async function lockTournamentStandings(client: PoolClient, tournamentId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
}

// Matches
function mapMatch(row: {
  id: string;
  tournament_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  match_date: string | null;
  venue: string | null;
  round: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  stage?: "GROUP" | "KNOCKOUT" | null;
  draw_version_id?: string | null;
  group_id?: string | null;
  round_number?: number | null;
  leg?: number | null;
  fixture_key?: string | null;
}): Match {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    matchDate: row.match_date,
    venue: row.venue,
    round: row.round,
    status: row.status as any,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.stage ? { stage: row.stage } : {}),
    ...(row.draw_version_id !== undefined ? { drawVersionId: row.draw_version_id } : {}),
    ...(row.group_id !== undefined ? { groupId: row.group_id } : {}),
    ...(row.round_number !== undefined ? { roundNumber: row.round_number } : {}),
    ...(row.leg !== undefined ? { leg: row.leg } : {}),
    ...(row.fixture_key !== undefined ? { fixtureKey: row.fixture_key } : {}),
  };
}

export async function findMatchById(id: string): Promise<Match | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round, status, created_at, updated_at
     FROM matches
     WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapMatch(result.rows[0]);
}

export async function listMatches(
  tournamentId: string,
  limit: number,
  offset: number,
  status?: string,
): Promise<{ items: Match[]; total: number }> {
  const pool = getPool();

  let countQuery = `SELECT COUNT(*)::text AS count FROM matches m WHERE m.tournament_id = $1
    AND NOT EXISTS (SELECT 1 FROM match_fixture_generations generation
      WHERE generation.draw_version_id=m.draw_version_id AND generation.publication_status='DRAFT'
        AND ((generation.stage='GROUP' AND m.group_id IS NOT NULL) OR (generation.stage='KNOCKOUT'
          AND EXISTS (SELECT 1 FROM match_bracket_slots slot WHERE slot.match_id=m.id))))`;
  let listQuery = `
    SELECT m.id, m.tournament_id, m.home_team_id, m.away_team_id, m.match_date, m.venue, m.round, m.status, m.created_at, m.updated_at,
           m.stage, m.draw_version_id, m.group_id, m.round_number, m.leg, m.fixture_key
    FROM matches m
    WHERE m.tournament_id = $1
      AND NOT EXISTS (SELECT 1 FROM match_fixture_generations generation
        WHERE generation.draw_version_id=m.draw_version_id AND generation.publication_status='DRAFT'
          AND ((generation.stage='GROUP' AND m.group_id IS NOT NULL) OR (generation.stage='KNOCKOUT'
            AND EXISTS (SELECT 1 FROM match_bracket_slots slot WHERE slot.match_id=m.id))))
  `;
  const params: unknown[] = [tournamentId];
  let paramIndex = 2;

  if (status) {
    countQuery += ` AND m.status = $2`;
    listQuery += ` AND m.status = $2`;
    params.push(status);
    paramIndex++;
  }

  listQuery += ` ORDER BY m.match_date ASC NULLS LAST, m.id ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);

  const countResult = await pool.query<{ count: string }>(countQuery, status ? [tournamentId, status] : [tournamentId]);
  const total = Number(countResult.rows[0]?.count ?? 0);

  const result = await pool.query(listQuery, params);

  return {
    items: result.rows.map(mapMatch),
    total,
  };
}

export type FixtureStage = "GROUP" | "KNOCKOUT";
export type FixturePublicationStatus = "DRAFT" | "PUBLISHED";

export async function getRosterAdditionEligibility(tournamentId: string, playerIds: string[]) {
  const pool = getPool();
  const stage = await pool.query<{ group_round_count: number; final_round: number | null; final_round_starts_at: Date | null }>(
    `WITH base_group_matches AS (
       SELECT m.match_date, m.group_id, COALESCE(m.leg,1)::integer AS leg, m.round_number,
         MAX(m.round_number) OVER (PARTITION BY m.group_id) AS rounds_per_leg
       FROM matches m JOIN match_fixture_generations g ON g.draw_version_id=m.draw_version_id AND g.stage='GROUP'
       WHERE m.tournament_id=$1 AND m.group_id IS NOT NULL AND m.status <> 'CANCELLED'
     ), group_matches AS (
       SELECT match_date, ((leg-1)*rounds_per_leg+round_number)::integer AS round_number
       FROM base_group_matches WHERE round_number IS NOT NULL
     ), final_round AS (SELECT MAX(round_number) AS round_number FROM group_matches)
     SELECT COUNT(DISTINCT gm.round_number)::integer AS group_round_count, fr.round_number AS final_round,
       MIN(gm.match_date) FILTER (WHERE gm.round_number=fr.round_number) AS final_round_starts_at
     FROM group_matches gm CROSS JOIN final_round fr GROUP BY fr.round_number`, [tournamentId],
  );
  const row = stage.rows[0];
  if (!row || row.group_round_count === 0 || row.final_round === null) {
    return { eligible: false, reason: "Giải chưa có lịch vòng bảng có vòng được xác định; giải chỉ loại trực tiếp không hỗ trợ bổ sung sau khóa roster.", finalGroupRound: null, finalGroupRoundStartsAt: null, alreadyAppearedPlayerIds: [] as string[] };
  }
  if (!row.final_round_starts_at) {
    return { eligible: false, reason: "Lịch thi đấu vòng cuối vòng bảng chưa có thời điểm bắt đầu.", finalGroupRound: row.final_round, finalGroupRoundStartsAt: null, alreadyAppearedPlayerIds: [] as string[] };
  }
  const appeared = playerIds.length ? await pool.query<{ player_id: string }>(
    `SELECT DISTINCT player_id FROM (
       SELECT l.player_id FROM lineups l JOIN matches m ON m.id=l.match_id
        WHERE m.tournament_id=$1 AND l.player_id=ANY($2::uuid[])
          AND m.status IN ('LINEUP_CONFIRMED','IN_PROGRESS','FINISHED','VERIFIED','LOCKED')
       UNION
       SELECT e.player_id FROM match_events e JOIN matches m ON m.id=e.match_id
        WHERE m.tournament_id=$1 AND e.player_id=ANY($2::uuid[])
          AND m.status IN ('IN_PROGRESS','FINISHED','VERIFIED','LOCKED')
     ) appeared`, [tournamentId, playerIds],
  ) : { rows: [] as Array<{ player_id: string }> };
  const ids = appeared.rows.map((item) => item.player_id);
  if (ids.length) return { eligible: false, reason: "Có cầu thủ đã có tên trong đội hình hoặc diễn biến trận đã bắt đầu.", finalGroupRound: row.final_round, finalGroupRoundStartsAt: row.final_round_starts_at.toISOString(), alreadyAppearedPlayerIds: ids };
  if (row.final_round_starts_at.getTime() <= Date.now()) {
    return { eligible: false, reason: "Vòng cuối vòng bảng đã bắt đầu; không thể bổ sung cầu thủ.", finalGroupRound: row.final_round, finalGroupRoundStartsAt: row.final_round_starts_at.toISOString(), alreadyAppearedPlayerIds: [] as string[] };
  }
  return { eligible: true, reason: null, finalGroupRound: row.final_round, finalGroupRoundStartsAt: row.final_round_starts_at.toISOString(), alreadyAppearedPlayerIds: [] as string[] };
}

export async function isFixtureMatchPublic(matchId: string): Promise<boolean> {
  const result = await getPool().query<{ visible: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM matches m JOIN match_fixture_generations generation ON generation.draw_version_id=m.draw_version_id
       WHERE m.id=$1 AND generation.publication_status='DRAFT'
         AND ((generation.stage='GROUP' AND m.group_id IS NOT NULL) OR
              (generation.stage='KNOCKOUT' AND EXISTS (SELECT 1 FROM match_bracket_slots slot WHERE slot.match_id=m.id)))
     ) AS visible`, [matchId],
  );
  return result.rows[0]?.visible ?? false;
}

export async function listManagedTournamentFixtures(tournamentId: string): Promise<{
  stages: Array<{ drawVersionId: string; stage: FixtureStage; legs: 1 | 2; regulationVersion: number | null; status: FixturePublicationStatus; createdAt: string; publishedAt: string | null; matches: Match[] }>;
}> {
  const result = await getPool().query<{
    draw_version_id: string; stage: FixtureStage; legs: number; regulation_version: number | null; publication_status: FixturePublicationStatus;
    created_at: Date; published_at: Date | null;
  }>(
    `SELECT draw_version_id, stage, legs, regulation_version, publication_status, created_at, published_at
     FROM match_fixture_generations WHERE tournament_id=$1 ORDER BY created_at, stage`,
    [tournamentId],
  );
  const stages = await Promise.all(result.rows.map(async (generation) => {
    const matches = await getPool().query(
      `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round, status, created_at, updated_at,
              stage, draw_version_id, group_id, round_number, leg, fixture_key
       FROM matches WHERE tournament_id=$1 AND draw_version_id=$2
         AND ($3='GROUP' AND group_id IS NOT NULL OR $3='KNOCKOUT' AND EXISTS (
           SELECT 1 FROM match_bracket_slots slot WHERE slot.match_id=matches.id
         ))
       ORDER BY round, fixture_key`,
      [tournamentId, generation.draw_version_id, generation.stage],
    );
    return {
      drawVersionId: generation.draw_version_id,
      stage: generation.stage,
      legs: generation.legs as 1 | 2,
      regulationVersion: generation.regulation_version,
      status: generation.publication_status,
      createdAt: generation.created_at.toISOString(),
      publishedAt: generation.published_at?.toISOString() ?? null,
      matches: matches.rows.map(mapMatch),
    };
  }));
  return { stages };
}

export async function publishTournamentFixtureStage(
  tournamentId: string,
  stage: FixtureStage,
  currentPublishedDrawVersionId: string,
  userId: string,
): Promise<{ drawVersionId: string; stage: FixtureStage; status: FixturePublicationStatus; publishedAt: string; matchCount: number }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`fixtures:${tournamentId}`]);
    const generation = await client.query<{ draw_version_id: string; publication_status: FixturePublicationStatus }>(
      `SELECT draw_version_id, publication_status FROM match_fixture_generations
       WHERE tournament_id=$1 AND stage=$2 AND draw_version_id=$3 FOR UPDATE`,
      [tournamentId, stage, currentPublishedDrawVersionId],
    );
    if (!generation.rowCount) throw new AppError(409, "Không có bản nháp thuộc draw đang công bố cho giai đoạn này", "FIXTURE_DRAFT_REQUIRED");
    const { draw_version_id: drawVersionId, publication_status: currentStatus } = generation.rows[0];
    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM matches match
       WHERE match.tournament_id=$1 AND match.draw_version_id=$2 AND
         (($3='GROUP' AND match.group_id IS NOT NULL) OR ($3='KNOCKOUT' AND EXISTS (
           SELECT 1 FROM match_bracket_slots slot WHERE slot.match_id=match.id
         )))`,
      [tournamentId, drawVersionId, stage],
    );
    const matchCount = Number(count.rows[0]?.count ?? 0);
    if (matchCount === 0) throw new AppError(409, "Sơ đồ chưa có trận hợp lệ để công bố", "FIXTURE_DRAFT_EMPTY");
    const updated = await client.query<{ published_at: Date }>(
      `UPDATE match_fixture_generations SET publication_status='PUBLISHED', published_by=COALESCE(published_by,$3),
         published_at=COALESCE(published_at, NOW()) WHERE tournament_id=$1 AND draw_version_id=$2 AND stage=$4
       RETURNING published_at`,
      [tournamentId, drawVersionId, userId, stage],
    );
    const first = await client.query<{ id: string }>(
      `SELECT id FROM matches WHERE tournament_id=$1 AND draw_version_id=$2
       ORDER BY fixture_key NULLS LAST, id LIMIT 1`, [tournamentId, drawVersionId],
    );
    if (first.rowCount && currentStatus !== "PUBLISHED") {
      await publishMatchUpdate(client, first.rows[0].id, "fixtures.stage.published");
    }
    await client.query("COMMIT");
    return { drawVersionId, stage, status: "PUBLISHED", publishedAt: updated.rows[0].published_at.toISOString(), matchCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** Publish every required phase for one draw version atomically (notably hybrid group + knockout). */
export async function publishTournamentFixtureStructure(
  tournamentId: string,
  stages: FixtureStage[],
  currentPublishedDrawVersionId: string,
  expectedMatchCounts: Partial<Record<FixtureStage, number>>,
  regulationVersion: number | null,
  userId: string,
  validateOnly = false,
): Promise<Array<{ drawVersionId: string; stage: FixtureStage; status: FixturePublicationStatus; publishedAt: string; matchCount: number }>> {
  if (!stages.length || new Set(stages).size !== stages.length) {
    throw new AppError(400, "Danh sách giai đoạn công bố không hợp lệ", "VALIDATION_ERROR");
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`fixtures:${tournamentId}`]);
    const publications = [] as Array<{ drawVersionId: string; stage: FixtureStage; status: FixturePublicationStatus; publishedAt: string; matchCount: number }>;
    for (const stage of stages) {
      const generation = await client.query<{ publication_status: FixturePublicationStatus; regulation_version: number | null }>(
        `SELECT publication_status, regulation_version FROM match_fixture_generations
         WHERE tournament_id=$1 AND stage=$2 AND draw_version_id=$3 FOR UPDATE`,
        [tournamentId, stage, currentPublishedDrawVersionId],
      );
      if (!generation.rowCount) throw new AppError(409, `Chưa tạo bản nháp ${stage} cho bản chia đã công bố`, "FIXTURE_DRAFT_REQUIRED");
      if (generation.rows[0].regulation_version !== regulationVersion) {
        throw new AppError(409, "Bản sơ đồ được tạo theo phiên bản điều lệ khác; hãy tạo lại sơ đồ từ điều lệ hiện hành trước khi công bố", "FIXTURE_REGULATION_VERSION_MISMATCH");
      }
      const count = await client.query<{ count: string; malformed: string }>(
        `SELECT COUNT(*)::text AS count,
           COUNT(*) FILTER (WHERE m.home_team_id IS NOT NULL AND m.home_team_id=m.away_team_id)::text AS malformed
         FROM matches m WHERE m.tournament_id=$1 AND m.draw_version_id=$2 AND m.stage=$3`,
        [tournamentId, currentPublishedDrawVersionId, stage],
      );
      const matchCount = Number(count.rows[0]?.count ?? 0);
      const expected = expectedMatchCounts[stage];
      if (!Number.isInteger(expected) || expected! < 1 || matchCount !== expected) {
        throw new AppError(409, `Giai đoạn ${stage} có ${matchCount}/${expected ?? "?"} trận theo cấu hình chính thức`, "FIXTURE_STRUCTURE_INCOMPLETE");
      }
      if (Number(count.rows[0]?.malformed ?? 0) > 0) {
        throw new AppError(409, "Sơ đồ có trận tự gặp chính mình", "INVALID_FIXTURE_STRUCTURE");
      }
      if (stage === "GROUP") {
        const groupCheck = await client.query<{ duplicate_pairs: string; repeated_round_teams: string }>(
          `WITH pairs AS (
             SELECT group_id, leg, LEAST(home_team_id,away_team_id) AS first_team,
                    GREATEST(home_team_id,away_team_id) AS second_team, COUNT(*) AS n
             FROM matches WHERE tournament_id=$1 AND draw_version_id=$2 AND stage='GROUP'
             GROUP BY group_id, leg, LEAST(home_team_id,away_team_id), GREATEST(home_team_id,away_team_id)
           ), appearances AS (
             SELECT group_id,leg,round_number,team_id,COUNT(*) AS n FROM (
               SELECT group_id,leg,round_number,home_team_id AS team_id FROM matches
                WHERE tournament_id=$1 AND draw_version_id=$2 AND stage='GROUP'
               UNION ALL
               SELECT group_id,leg,round_number,away_team_id AS team_id FROM matches
                WHERE tournament_id=$1 AND draw_version_id=$2 AND stage='GROUP'
             ) played GROUP BY group_id,leg,round_number,team_id
           )
           SELECT (SELECT COUNT(*) FROM pairs WHERE n<>1)::text AS duplicate_pairs,
                  (SELECT COUNT(*) FROM appearances WHERE n<>1)::text AS repeated_round_teams`,
          [tournamentId, currentPublishedDrawVersionId],
        );
        if (Number(groupCheck.rows[0]?.duplicate_pairs ?? 0) || Number(groupCheck.rows[0]?.repeated_round_teams ?? 0)) {
          throw new AppError(409, "Vòng bảng có cặp đấu lặp hoặc đội xuất hiện nhiều lần trong cùng vòng", "INVALID_GROUP_FIXTURES");
        }
      }
      if (stage === "KNOCKOUT") {
        const invalidLinks = await client.query(
          `SELECT slot.id FROM match_bracket_slots slot
           LEFT JOIN matches match ON match.id=slot.match_id
           LEFT JOIN match_bracket_slots home ON home.id=slot.home_source_slot_id
           LEFT JOIN match_bracket_slots away ON away.id=slot.away_source_slot_id
           WHERE slot.tournament_id=$1 AND slot.draw_version_id=$2 AND (
             (slot.match_id IS NOT NULL AND (match.id IS NULL OR match.draw_version_id<>slot.draw_version_id OR match.stage<>'KNOCKOUT'))
             OR (slot.home_source_slot_id IS NOT NULL AND (home.id IS NULL OR home.draw_version_id<>slot.draw_version_id OR home.round_number<>slot.round_number-1))
             OR (slot.away_source_slot_id IS NOT NULL AND (away.id IS NULL OR away.draw_version_id<>slot.draw_version_id OR away.round_number<>slot.round_number-1))
           ) LIMIT 1`, [tournamentId, currentPublishedDrawVersionId],
        );
        if (invalidLinks.rowCount) throw new AppError(409, "Nhánh đấu có mã trận hoặc liên kết trận nguồn không hợp lệ", "INVALID_BRACKET_STRUCTURE");
        const orphanedMatches = await client.query(
          `SELECT match.id FROM matches match WHERE match.tournament_id=$1 AND match.draw_version_id=$2 AND match.stage='KNOCKOUT'
           AND NOT EXISTS (SELECT 1 FROM match_bracket_slots slot WHERE slot.match_id=match.id) LIMIT 1`,
          [tournamentId, currentPublishedDrawVersionId],
        );
        if (orphanedMatches.rowCount) throw new AppError(409, "Có trận loại trực tiếp không thuộc vị trí nào trên cây đấu", "INVALID_BRACKET_STRUCTURE");
      }
      if (validateOnly) continue;
      const update = await client.query<{ published_at: Date }>(
        `UPDATE match_fixture_generations SET publication_status='PUBLISHED', published_by=COALESCE(published_by,$4),
          published_at=COALESCE(published_at,NOW())
         WHERE tournament_id=$1 AND draw_version_id=$2 AND stage=$3 RETURNING published_at`,
        [tournamentId, currentPublishedDrawVersionId, stage, userId],
      );
      const first = await client.query<{ id: string }>(
        "SELECT id FROM matches WHERE tournament_id=$1 AND draw_version_id=$2 AND stage=$3 ORDER BY fixture_key,id LIMIT 1",
        [tournamentId, currentPublishedDrawVersionId, stage],
      );
      if (first.rowCount && generation.rows[0].publication_status !== "PUBLISHED") {
        await publishMatchUpdate(client, first.rows[0].id, "fixtures.stage.published");
      }
      publications.push({ drawVersionId: currentPublishedDrawVersionId, stage, status: "PUBLISHED", publishedAt: update.rows[0].published_at.toISOString(), matchCount });
    }
    await client.query("COMMIT");
    return publications;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function listLiveMatchSummaries(): Promise<Array<Match & {
  homeScore: number; awayScore: number; clockPhase: string | null;
  elapsedSeconds: number; clockStartedAt: string | null; isClockRunning: boolean;
}>> {
  const result = await getPool().query(`
    SELECT m.id, m.tournament_id, m.home_team_id, m.away_team_id, m.match_date, m.venue, m.round,
           m.status, m.created_at, m.updated_at,
           COALESCE(SUM(CASE
             WHEN e.event_type IN ('GOAL','PENALTY_GOAL') AND e.team_id = m.home_team_id THEN 1
             WHEN e.event_type = 'OWN_GOAL' AND e.team_id = m.away_team_id THEN 1 ELSE 0 END), 0)::INTEGER AS home_score,
           COALESCE(SUM(CASE
             WHEN e.event_type IN ('GOAL','PENALTY_GOAL') AND e.team_id = m.away_team_id THEN 1
             WHEN e.event_type = 'OWN_GOAL' AND e.team_id = m.home_team_id THEN 1 ELSE 0 END), 0)::INTEGER AS away_score,
           clock.phase AS clock_phase,
           clock.started_at AS clock_started_at,
           COALESCE(clock.elapsed_seconds + CASE WHEN clock.is_running AND clock.started_at IS NOT NULL
             THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - clock.started_at)))::INTEGER) ELSE 0 END, 0)::INTEGER AS elapsed_seconds,
           COALESCE(clock.is_running, FALSE) AS is_clock_running
    FROM matches m
    LEFT JOIN match_events e ON e.match_id = m.id AND e.voided_at IS NULL
    LEFT JOIN match_clock_states clock ON clock.match_id = m.id
    WHERE m.status = 'IN_PROGRESS'
      AND NOT EXISTS (SELECT 1 FROM match_fixture_generations generation
        WHERE generation.draw_version_id=m.draw_version_id AND generation.publication_status='DRAFT'
          AND ((generation.stage='GROUP' AND m.group_id IS NOT NULL) OR (generation.stage='KNOCKOUT'
            AND EXISTS (SELECT 1 FROM match_bracket_slots slot WHERE slot.match_id=m.id))))
    GROUP BY m.id, clock.match_id
    ORDER BY m.match_date ASC NULLS LAST, m.id
  `);
  return result.rows.map((row) => ({
    ...mapMatch(row), homeScore: row.home_score, awayScore: row.away_score,
    clockPhase: row.clock_phase, elapsedSeconds: row.elapsed_seconds,
    clockStartedAt: row.clock_started_at?.toISOString() ?? null,
    isClockRunning: row.is_clock_running,
  }));
}

export async function createMatch(input: MatchCreateInput): Promise<Match> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO matches (tournament_id, home_team_id, away_team_id, match_date, venue, round)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tournament_id, home_team_id, away_team_id, match_date, venue, round, status, created_at, updated_at`,
    [
      input.tournamentId,
      input.homeTeamId,
      input.awayTeamId,
      input.matchDate,
      input.venue ?? null,
      input.round ?? null,
    ],
  );

  return mapMatch(result.rows[0]);
}

export async function generateGroupFixtures(
  tournamentId: string,
  drawVersionId: string,
  legs: 1 | 2,
  fixtures: GeneratedFixtureInput[],
  generatedBy: string,
  regulationVersion: number | null = null,
): Promise<FixtureGenerationResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const existingRun = await client.query<{ legs: number }>(
      "SELECT legs FROM match_fixture_generations WHERE draw_version_id = $1 AND stage = 'GROUP' FOR UPDATE",
      [drawVersionId],
    );
    if (existingRun.rowCount) {
      if (existingRun.rows[0].legs !== legs) {
        throw new AppError(409, "Fixtures đã được tạo với số lượt khác", "FIXTURES_ALREADY_GENERATED");
      }
      const existingMatches = await client.query(
        `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round,
                status, created_at, updated_at, 'GROUP'::text AS stage, draw_version_id, group_id,
                round_number, leg, fixture_key
         FROM matches WHERE draw_version_id = $1 AND group_id IS NOT NULL ORDER BY leg, round_number, fixture_key`,
        [drawVersionId],
      );
      await client.query("COMMIT");
      return {
        drawVersionId,
        legs,
        matches: existingMatches.rows.map(mapMatch),
        alreadyGenerated: true,
      };
    }

    const teamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId]))];
    const existingMatches = await client.query(
      `SELECT 1 FROM matches
       WHERE tournament_id = $1
         AND status != 'CANCELLED'
         AND (home_team_id = ANY($2::UUID[]) OR away_team_id = ANY($2::UUID[]))
       LIMIT 1`,
      [tournamentId, teamIds],
    );
    if (existingMatches.rowCount) {
      throw new AppError(
        409,
        "Đã có trận đấu cho các đội trong giải; không tạo trùng hoặc ghi đè lịch và kết quả hiện có",
        "MATCHES_ALREADY_EXIST",
      );
    }

    await client.query(
      `INSERT INTO match_fixture_generations (tournament_id, draw_version_id, legs, generated_by, stage, publication_status, regulation_version)
       VALUES ($1, $2, $3, $4, 'GROUP', 'DRAFT', $5)`,
      [tournamentId, drawVersionId, legs, generatedBy, regulationVersion],
    );
    for (const fixture of fixtures) {
      const fixtureKey = [
        fixture.groupId,
        fixture.leg,
        fixture.roundNumber,
        fixture.homeTeamId,
        fixture.awayTeamId,
      ].join(":");
      await client.query(
        `INSERT INTO matches
           (tournament_id, home_team_id, away_team_id, match_date, round, status, draw_version_id, fixture_key, group_id, stage, round_number, leg)
         VALUES ($1, $2, $3, NULL, $4, 'UNSCHEDULED', $5, $6, $7, 'GROUP', $8, $9)`,
        [
          tournamentId,
          fixture.homeTeamId,
          fixture.awayTeamId,
          fixture.round,
          drawVersionId,
          fixtureKey,
          fixture.groupId,
          fixture.roundNumber,
          fixture.leg,
        ],
      );
    }
    const generated = await client.query(
      `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round,
              status, created_at, updated_at, 'GROUP'::text AS stage, draw_version_id, group_id,
              round_number, leg, fixture_key
       FROM matches WHERE draw_version_id = $1 AND group_id IS NOT NULL ORDER BY round, fixture_key`,
      [drawVersionId],
    );
    if (generated.rowCount) {
      await publishMatchUpdate(client, generated.rows[0].id, "fixtures.group.generated");
    }
    await client.query("COMMIT");
    return {
      drawVersionId,
      legs,
      matches: generated.rows.map(mapMatch),
      alreadyGenerated: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function generateHybridPlayoffSkeleton(
  tournamentId: string,
  drawVersionId: string,
  qualificationSources: Array<{ groupId: string; groupRank: number }>,
  generatedBy: string,
  thirdPlaceMatch = false,
  regulationVersion: number | null = null,
): Promise<Match[]> {
  if (qualificationSources.length < 2 || qualificationSources.length > 32) {
    throw new AppError(409, "Số suất playoff phải từ 2 đến 32", "INVALID_PLAYOFF_FIELD_SIZE");
  }
  if (thirdPlaceMatch && qualificationSources.length < 4) {
    throw new AppError(409, "Trận tranh hạng ba cần tối thiểu bốn đội đi tiếp", "THIRD_PLACE_REQUIRES_FOUR_TEAMS");
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const existing = await client.query(
      "SELECT 1 FROM match_fixture_generations WHERE draw_version_id=$1 AND stage='KNOCKOUT' FOR UPDATE",
      [drawVersionId],
    );
    if (existing.rowCount) {
      if (thirdPlaceMatch) {
        const thirdPlace = await client.query("SELECT 1 FROM match_bracket_slots WHERE draw_version_id=$1 AND slot_type='THIRD_PLACE'", [drawVersionId]);
        if (!thirdPlace.rowCount) throw new AppError(409, "Khung playoff đã tồn tại nhưng thiếu trận tranh hạng ba theo điều lệ; cần BTC xử lý cấu trúc trước khi công bố", "THIRD_PLACE_FIXTURE_MISSING");
      }
      const matches = await client.query(
        `SELECT match.id, match.tournament_id, match.home_team_id, match.away_team_id, match.match_date, match.venue,
                match.round, match.status, match.created_at, match.updated_at, 'KNOCKOUT'::text AS stage,
                match.draw_version_id, match.group_id, match.round_number, match.leg, match.fixture_key
         FROM matches match JOIN match_bracket_slots slot ON slot.match_id=match.id
         WHERE match.draw_version_id=$1 ORDER BY match.round, match.fixture_key`, [drawVersionId],
      );
      await client.query("COMMIT");
      return matches.rows.map(mapMatch);
    }
    const placeholders = qualificationSources.map((source, index) => ({
      source,
      token: `qualification:${source.groupId}:${source.groupRank}`,
      seed: index + 1,
    }));
    if (new Set(placeholders.map(({ token }) => token)).size !== placeholders.length) {
      throw new AppError(409, "Một suất playoff được khai báo nhiều lần", "DUPLICATE_QUALIFICATION_SOURCE");
    }
    const sourceByToken = new Map(placeholders.map(({ source, token }) => [token, source]));
    const topology = createKnockoutBracket(placeholders.map(({ token, seed }) => ({ teamId: token, position: seed })));
    await client.query(
      `INSERT INTO match_fixture_generations (tournament_id, draw_version_id, legs, generated_by, stage, publication_status, regulation_version)
       VALUES ($1,$2,1,$3,'KNOCKOUT','DRAFT',$4)`, [tournamentId, drawVersionId, generatedBy, regulationVersion],
    );
    const idByRoundPosition = new Map<string, string>();
    for (const slot of topology) {
      const isFirstRound = slot.round === 1;
      const homeSourceSlot = slot.homeSourcePosition === null ? null : idByRoundPosition.get(`${slot.round - 1}:${slot.homeSourcePosition}`) ?? null;
      const awaySourceSlot = slot.awaySourcePosition === null ? null : idByRoundPosition.get(`${slot.round - 1}:${slot.awaySourcePosition}`) ?? null;
      const homeQualification = isFirstRound && slot.homeTeamId ? sourceByToken.get(slot.homeTeamId) ?? null : null;
      const awayQualification = isFirstRound && slot.awayTeamId ? sourceByToken.get(slot.awayTeamId) ?? null : null;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO match_bracket_slots
           (tournament_id, draw_version_id, round_number, position, home_team_id, away_team_id,
            home_source_slot_id, away_source_slot_id, home_resolved, away_resolved, status)
         VALUES ($1,$2,$3,$4,NULL,NULL,$5,$6,$7,$8,$9) RETURNING id`,
        [tournamentId, drawVersionId, slot.round, slot.position, homeSourceSlot, awaySourceSlot,
          isFirstRound ? !homeQualification : topology.some((parent) => parent.round === slot.round - 1 && parent.position === slot.homeSourcePosition && parent.empty),
          isFirstRound ? !awayQualification : topology.some((parent) => parent.round === slot.round - 1 && parent.position === slot.awaySourcePosition && parent.empty),
          slot.empty ? "BYE" : "WAITING"],
      );
      const slotId = inserted.rows[0].id;
      idByRoundPosition.set(`${slot.round}:${slot.position}`, slotId);
      for (const [side, source] of [["HOME", homeQualification], ["AWAY", awayQualification]] as const) {
        if (!source) continue;
        await client.query(
          `INSERT INTO match_bracket_qualification_sources (slot_id, draw_version_id, side, group_id, group_rank)
           VALUES ($1,$2,$3,$4,$5)`, [slotId, drawVersionId, side, source.groupId, source.groupRank],
        );
      }
      // Reserve real Match IDs for playable slots before team qualifiers are known.
      // A structural BYE has only one source in round one and must not create a fixture.
      if (!slot.bye) {
        const match = await client.query<{ id: string }>(
        `INSERT INTO matches (tournament_id, home_team_id, away_team_id, round, status, draw_version_id, fixture_key, stage, round_number, leg)
           VALUES ($1,NULL,NULL,$2,'UNSCHEDULED',$3,$4,'KNOCKOUT',$5,1)
           ON CONFLICT (tournament_id, fixture_key) WHERE fixture_key IS NOT NULL
             DO UPDATE SET updated_at=matches.updated_at
           RETURNING id`,
          [tournamentId, `Vòng ${slot.round} · Trận ${slot.position}`, drawVersionId, `knockout:${slot.round}:${slot.position}`, slot.round],
        );
        await client.query("UPDATE match_bracket_slots SET match_id=$2 WHERE id=$1", [slotId, match.rows[0].id]);
      }
    }
    if (thirdPlaceMatch) {
      const definition = createThirdPlaceBracketDefinition(qualificationSources.length);
      const semifinalOne = idByRoundPosition.get(`${definition.round - 1}:${definition.homeSourcePosition}`);
      const semifinalTwo = idByRoundPosition.get(`${definition.round - 1}:${definition.awaySourcePosition}`);
      if (!semifinalOne || !semifinalTwo) throw new AppError(409, "Không xác định được hai trận bán kết để lập trận tranh hạng ba", "THIRD_PLACE_SOURCES_MISSING");
      const slot = await client.query<{ id: string }>(
        `INSERT INTO match_bracket_slots
           (tournament_id, draw_version_id, round_number, position, home_source_slot_id, away_source_slot_id,
            home_source_outcome, away_source_outcome, home_resolved, away_resolved, status, slot_type)
         VALUES ($1,$2,$3,$4,$5,$6,'LOSER','LOSER',FALSE,FALSE,'WAITING','THIRD_PLACE') RETURNING id`,
        [tournamentId, drawVersionId, definition.round, definition.position, semifinalOne, semifinalTwo],
      );
      const match = await client.query<{ id: string }>(
        `INSERT INTO matches (tournament_id, round, status, draw_version_id, fixture_key, stage, round_number, leg)
         VALUES ($1,'Tranh hạng ba','UNSCHEDULED',$2,'knockout:third-place','KNOCKOUT',$3,1)
         ON CONFLICT (tournament_id, fixture_key) WHERE fixture_key IS NOT NULL DO UPDATE
           SET updated_at = matches.updated_at RETURNING id`,
        [tournamentId, drawVersionId, definition.round],
      );
      await client.query("UPDATE match_bracket_slots SET match_id=$2 WHERE id=$1", [slot.rows[0].id, match.rows[0].id]);
    }
    const generated = await client.query(
      `SELECT match.id, match.tournament_id, match.home_team_id, match.away_team_id, match.match_date, match.venue,
              match.round, match.status, match.created_at, match.updated_at,
              'KNOCKOUT'::text AS stage, match.draw_version_id, match.group_id, match.round_number, match.leg, match.fixture_key
       FROM matches match JOIN match_bracket_slots slot ON slot.match_id=match.id
       WHERE match.draw_version_id=$1 ORDER BY match.round, match.fixture_key`, [drawVersionId],
    );
    if (generated.rowCount) await publishMatchUpdate(client, generated.rows[0].id, "fixtures.hybrid.playoff-skeleton.created");
    await client.query("COMMIT");
    return generated.rows.map(mapMatch);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function generateKnockoutFixtures(
  tournamentId: string,
  drawVersionId: string,
  teamIds: string[],
  generatedBy: string,
  allowGroupStageMatches = false,
  qualifications: Array<{ teamId: string; groupId: string; groupRank: number }> = [],
  lotDrawAudits: AuditableGroupLotDraw[] = [],
  thirdPlaceMatch = false,
  regulationVersion: number | null = null,
  publishedPositions?: Array<{ teamId: string; position: number }>,
): Promise<FixtureGenerationResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const run = await client.query<{ legs: number }>(
      "SELECT legs FROM match_fixture_generations WHERE draw_version_id = $1 AND stage = 'KNOCKOUT' FOR UPDATE", [drawVersionId],
    );
    if (run.rowCount) {
      let completedSkeleton = false;
      if (qualifications.length) {
        const savedQualifications = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM match_knockout_qualifications WHERE draw_version_id=$1",
          [drawVersionId],
        );
        if (Number(savedQualifications.rows[0].count) === 0) {
          const sources = await client.query<{ slot_id: string; side: "HOME" | "AWAY"; group_id: string; group_rank: number }>(
            `SELECT slot_id, side, group_id, group_rank FROM match_bracket_qualification_sources
             WHERE draw_version_id=$1 ORDER BY group_rank, group_id`, [drawVersionId],
          );
          if (sources.rowCount) {
            const qualificationBySource = new Map(qualifications.map((item) => [`${item.groupId}:${item.groupRank}`, item]));
            if (sources.rowCount !== qualifications.length || sources.rows.some((source) => !qualificationBySource.has(`${source.group_id}:${source.group_rank}`))) {
              throw new AppError(409, "Danh sách đội đi tiếp không khớp với các vị trí playoff đã công bố", "PLAYOFF_QUALIFICATION_MISMATCH");
            }
            for (const qualification of qualifications) {
              await client.query(
                `INSERT INTO match_knockout_qualifications (tournament_id, draw_version_id, team_id, group_id, group_rank)
                 VALUES ($1,$2,$3,$4,$5)`,
                [tournamentId, drawVersionId, qualification.teamId, qualification.groupId, qualification.groupRank],
              );
            }
            for (const audit of lotDrawAudits) {
              const tiedTeamIds = [...audit.tiedTeamIds].sort();
              await client.query(
                `INSERT INTO match_group_lot_draws
                   (tournament_id, draw_version_id, group_id, tie_key, tied_team_ids, drawn_order, witness_name, reason, drawn_by)
                 VALUES ($1,$2,$3,$4,$5::UUID[],$6::UUID[],$7,$8,$9)`,
                [tournamentId, drawVersionId, audit.groupId, tiedTeamIds.join(":"), tiedTeamIds, audit.drawnOrder, audit.witnessName.trim(), audit.reason.trim(), generatedBy],
              );
            }
            for (const source of sources.rows) {
              const qualification = qualificationBySource.get(`${source.group_id}:${source.group_rank}`)!;
              const teamColumn = source.side === "HOME" ? "home_team_id" : "away_team_id";
              const resolvedColumn = source.side === "HOME" ? "home_resolved" : "away_resolved";
              await client.query(
                `UPDATE match_bracket_slots SET ${teamColumn}=$2, ${resolvedColumn}=TRUE, updated_at=NOW() WHERE id=$1`,
                [source.slot_id, qualification.teamId],
              );
            }
            await client.query(
              `UPDATE match_bracket_slots SET
                 status = CASE WHEN home_team_id IS NOT NULL AND away_team_id IS NOT NULL THEN 'READY' ELSE 'BYE' END,
                 winner_team_id = CASE WHEN home_team_id IS NULL OR away_team_id IS NULL THEN COALESCE(home_team_id, away_team_id) ELSE NULL END,
                 updated_at=NOW()
               WHERE draw_version_id=$1 AND round_number=1 AND status='WAITING'
                 AND home_resolved=TRUE AND away_resolved=TRUE`, [drawVersionId],
            );
            await resolveReadyBracketSlots(client, tournamentId, drawVersionId);
            completedSkeleton = true;
          }
        }
      }
      const matches = await client.query(
        `SELECT match.id, match.tournament_id, match.home_team_id, match.away_team_id, match.match_date, match.venue, match.round, match.status, match.created_at, match.updated_at,
                'KNOCKOUT'::text AS stage, match.draw_version_id, match.group_id, match.round_number, match.leg, match.fixture_key
         FROM matches match JOIN match_bracket_slots slot ON slot.match_id = match.id
         WHERE match.draw_version_id = $1 ORDER BY match.round, match.fixture_key`, [drawVersionId],
      );
      if (completedSkeleton && matches.rowCount) {
        await publishMatchUpdate(client, matches.rows[0].id, "fixtures.hybrid.qualifiers.resolved");
      }
      await client.query("COMMIT");
      return { drawVersionId, legs: 1, matches: matches.rows.map(mapMatch), alreadyGenerated: !completedSkeleton };
    }
    const otherMatches = await client.query(
      `SELECT 1 FROM matches
       WHERE tournament_id = $1 AND status <> 'CANCELLED'
         AND (home_team_id = ANY($2::UUID[]) OR away_team_id = ANY($2::UUID[]))
         AND NOT ($3::BOOLEAN AND draw_version_id = $4 AND group_id IS NOT NULL)
       LIMIT 1`,
      [tournamentId, teamIds, allowGroupStageMatches, drawVersionId],
    );
    if (otherMatches.rowCount) throw new AppError(409, "Đã có trận cho các đội trong giải; không tạo trùng lịch", "MATCHES_ALREADY_EXIST");

    await client.query(
      "INSERT INTO match_fixture_generations (tournament_id, draw_version_id, legs, generated_by, stage, publication_status, regulation_version) VALUES ($1, $2, 1, $3, 'KNOCKOUT', 'DRAFT', $4)",
      [tournamentId, drawVersionId, generatedBy, regulationVersion],
    );
    for (const qualification of qualifications) {
      await client.query(
        `INSERT INTO match_knockout_qualifications (tournament_id, draw_version_id, team_id, group_id, group_rank)
         VALUES ($1, $2, $3, $4, $5)`,
        [tournamentId, drawVersionId, qualification.teamId, qualification.groupId, qualification.groupRank],
      );
    }
    for (const audit of lotDrawAudits) {
      const tiedTeamIds = [...audit.tiedTeamIds].sort();
      await client.query(
        `INSERT INTO match_group_lot_draws
           (tournament_id, draw_version_id, group_id, tie_key, tied_team_ids, drawn_order, witness_name, reason, drawn_by)
         VALUES ($1,$2,$3,$4,$5::UUID[],$6::UUID[],$7,$8,$9)`,
        [tournamentId, drawVersionId, audit.groupId, tiedTeamIds.join(":"), tiedTeamIds, audit.drawnOrder, audit.witnessName.trim(), audit.reason.trim(), generatedBy],
      );
    }
    const topology = createKnockoutBracket(publishedPositions ?? teamIds.map((teamId, index) => ({ teamId, seed: index + 1 })));
    const idByRoundPosition = new Map<string, string>();
    for (const slot of topology) {
      const homeSource = slot.homeSourcePosition === null ? null : idByRoundPosition.get(`${slot.round - 1}:${slot.homeSourcePosition}`) ?? null;
      const awaySource = slot.awaySourcePosition === null ? null : idByRoundPosition.get(`${slot.round - 1}:${slot.awaySourcePosition}`) ?? null;
      const isFirstRound = slot.round === 1;
      const status = isFirstRound
        ? (slot.bye ? "BYE" : "READY")
        : slot.empty ? "BYE" : "WAITING";
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO match_bracket_slots
           (tournament_id, draw_version_id, round_number, position, home_team_id, away_team_id,
            home_source_slot_id, away_source_slot_id, home_resolved, away_resolved, winner_team_id, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [tournamentId, drawVersionId, slot.round, slot.position, slot.homeTeamId, slot.awayTeamId,
          homeSource, awaySource,
          isFirstRound || topology.some((parent) => parent.round === slot.round - 1 && parent.position === slot.homeSourcePosition && parent.empty),
          isFirstRound || topology.some((parent) => parent.round === slot.round - 1 && parent.position === slot.awaySourcePosition && parent.empty),
          slot.byeWinnerTeamId, status],
      );
      idByRoundPosition.set(`${slot.round}:${slot.position}`, inserted.rows[0].id);
      if (!slot.bye) {
        const fixtureKey = `knockout:${slot.round}:${slot.position}`;
        const match = await client.query<{ id: string }>(
          `INSERT INTO matches
             (tournament_id, home_team_id, away_team_id, round, status, draw_version_id, fixture_key, stage, round_number, leg)
           VALUES ($1,$2,$3,$4,'UNSCHEDULED',$5,$6,'KNOCKOUT',$7,1)
           ON CONFLICT (tournament_id, fixture_key) WHERE fixture_key IS NOT NULL DO UPDATE
             SET updated_at = matches.updated_at
           RETURNING id`,
          [tournamentId, slot.homeTeamId, slot.awayTeamId,
            `Vòng ${slot.round} · Trận ${slot.position}`, drawVersionId, fixtureKey, slot.round],
        );
        await client.query("UPDATE match_bracket_slots SET match_id=$2 WHERE id=$1", [inserted.rows[0].id, match.rows[0].id]);
      }
    }
    if (thirdPlaceMatch) {
      let definition;
      try { definition = createThirdPlaceBracketDefinition(teamIds.length); }
      catch (error) { throw new AppError(409, error instanceof Error ? error.message : "Số đội không hỗ trợ trận tranh hạng ba", "THIRD_PLACE_REQUIRES_FOUR_TEAMS"); }
      const semifinalOne = idByRoundPosition.get(`${definition.round - 1}:${definition.homeSourcePosition}`);
      const semifinalTwo = idByRoundPosition.get(`${definition.round - 1}:${definition.awaySourcePosition}`);
      if (!semifinalOne || !semifinalTwo) throw new AppError(409, "Không xác định được hai trận bán kết để lập trận tranh hạng ba", "THIRD_PLACE_SOURCES_MISSING");
      const slot = await client.query<{ id: string }>(
        `INSERT INTO match_bracket_slots
           (tournament_id, draw_version_id, round_number, position, home_source_slot_id, away_source_slot_id,
            home_source_outcome, away_source_outcome, home_resolved, away_resolved, status, slot_type)
         VALUES ($1,$2,$3,$4,$5,$6,'LOSER','LOSER',FALSE,FALSE,'WAITING','THIRD_PLACE') RETURNING id`,
        [tournamentId, drawVersionId, definition.round, definition.position, semifinalOne, semifinalTwo],
      );
      const match = await client.query<{ id: string }>(
        `INSERT INTO matches (tournament_id, round, status, draw_version_id, fixture_key, stage, round_number, leg)
         VALUES ($1,'Tranh hạng ba','UNSCHEDULED',$2,'knockout:third-place','KNOCKOUT',$3,1)
         ON CONFLICT (tournament_id, fixture_key) WHERE fixture_key IS NOT NULL DO UPDATE
           SET updated_at = matches.updated_at RETURNING id`,
        [tournamentId, drawVersionId, definition.round],
      );
      await client.query("UPDATE match_bracket_slots SET match_id=$2 WHERE id=$1", [slot.rows[0].id, match.rows[0].id]);
    }
    await resolveReadyBracketSlots(client, tournamentId, drawVersionId);
    const generated = await client.query(
      `SELECT match.id, match.tournament_id, match.home_team_id, match.away_team_id, match.match_date, match.venue, match.round, match.status, match.created_at, match.updated_at,
              'KNOCKOUT'::text AS stage, match.draw_version_id, match.group_id, match.round_number, match.leg, match.fixture_key
       FROM matches match JOIN match_bracket_slots slot ON slot.match_id = match.id
       WHERE match.draw_version_id = $1 ORDER BY match.round, match.fixture_key`, [drawVersionId],
    );
    if (generated.rowCount) {
      await publishMatchUpdate(client, generated.rows[0].id, "fixtures.knockout.generated");
    }
    await client.query("COMMIT");
    return { drawVersionId, legs: 1, matches: generated.rows.map(mapMatch), alreadyGenerated: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function getGroupStageFixtures(tournamentId: string, drawVersionId: string, groupId: string): Promise<{
  legs: number;
  fixtures: Array<{
    homeTeamId: string;
    awayTeamId: string;
    homeScore: number;
    awayScore: number;
    status: string;
    resultStatus: string;
  }>;
  fairPlayPoints: Record<string, number>;
}> {
  const pool = getPool();
  const generation = await pool.query<{ legs: number }>(
    "SELECT legs FROM match_fixture_generations WHERE tournament_id=$1 AND draw_version_id=$2 AND stage='GROUP'",
    [tournamentId, drawVersionId],
  );
  if (!generation.rowCount) throw new AppError(409, "Chưa tạo lịch vòng bảng cho draw đã công bố", "GROUP_FIXTURES_REQUIRED");
  const rows = await pool.query<{
    home_team_id: string; away_team_id: string; home_score: number; away_score: number;
    status: string; result_status: string;
  }>(
    `SELECT match.home_team_id, match.away_team_id, result.home_score, result.away_score,
            match.status, result.status AS result_status
     FROM matches match LEFT JOIN match_results result ON result.match_id=match.id
     WHERE match.tournament_id=$1 AND match.draw_version_id=$2 AND match.group_id=$3
     ORDER BY match.round, match.fixture_key`,
    [tournamentId, drawVersionId, groupId],
  );
  const fairPlay = await pool.query<{ team_id: string; penalty: string }>(
    `SELECT card_events.team_id,
            SUM(CASE WHEN card_events.red_count > 0 AND card_events.yellow_count > 0 THEN 5
                     WHEN card_events.red_count > 0 THEN 4 ELSE card_events.yellow_count END)::TEXT AS penalty
     FROM (
       SELECT event.team_id, event.player_id, event.match_id,
              COUNT(*) FILTER (WHERE event.event_type='YELLOW_CARD')::INTEGER AS yellow_count,
              COUNT(*) FILTER (WHERE event.event_type='RED_CARD')::INTEGER AS red_count
       FROM match_events event JOIN matches match ON match.id=event.match_id
       WHERE match.tournament_id=$1 AND match.draw_version_id=$2 AND match.group_id=$3
         AND match.status IN ('VERIFIED','LOCKED')
         AND EXISTS (SELECT 1 FROM match_results approved WHERE approved.match_id=match.id AND approved.status='APPROVED')
         AND event.event_type IN ('YELLOW_CARD','RED_CARD') AND event.voided_at IS NULL
       GROUP BY event.team_id, event.player_id, event.match_id
     ) card_events GROUP BY card_events.team_id`,
    [tournamentId, drawVersionId, groupId],
  );
  return {
    legs: generation.rows[0].legs,
    fixtures: rows.rows.map((row) => ({
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeScore: row.home_score ?? 0,
      awayScore: row.away_score ?? 0,
      status: row.status,
      resultStatus: row.result_status ?? "PENDING",
    })),
    fairPlayPoints: Object.fromEntries(fairPlay.rows.map((row) => [row.team_id, Number(row.penalty)])),
  };
}

/** Resolve BYEs and create a match only when both participant slots are final. */
export async function resolveReadyBracketSlots(
  client: PoolClient,
  tournamentId: string,
  drawVersionId: string,
): Promise<void> {
  for (;;) {
    const rows = await client.query<{
      id: string; round_number: number; position: number; home_team_id: string | null; away_team_id: string | null;
      match_id: string | null;
      home_resolved: boolean; away_resolved: boolean; status: string;
    }>(
      `SELECT id, round_number, position, home_team_id, away_team_id, home_resolved, away_resolved, status, match_id
       FROM match_bracket_slots WHERE tournament_id = $1 AND draw_version_id = $2
         AND home_resolved AND away_resolved AND status IN ('READY','BYE') ORDER BY round_number, position FOR UPDATE`,
      [tournamentId, drawVersionId],
    );
    let changed = false;
    for (const slot of rows.rows) {
      if (slot.status === "READY") {
        if (slot.match_id) {
          const updated = await client.query(
            `UPDATE matches SET home_team_id=$2, away_team_id=$3, updated_at=NOW()
             WHERE id=$1 AND (home_team_id IS DISTINCT FROM $2 OR away_team_id IS DISTINCT FROM $3)`,
            [slot.match_id, slot.home_team_id, slot.away_team_id],
          );
          changed = (updated.rowCount ?? 0) > 0 || changed;
          continue;
        }
        const match = await client.query<{ id: string }>(
          `INSERT INTO matches (tournament_id, home_team_id, away_team_id, match_date, round, status, draw_version_id, fixture_key)
           VALUES ($1,$2,$3,NULL,$4,'UNSCHEDULED',$5,$6)
           ON CONFLICT (tournament_id, fixture_key) WHERE fixture_key IS NOT NULL DO NOTHING
           RETURNING id`,
          [tournamentId, slot.home_team_id, slot.away_team_id, `Vòng ${slot.round_number}`, drawVersionId, `knockout:${slot.round_number}:${slot.position}`],
        );
        if (match.rowCount) {
          await client.query("UPDATE match_bracket_slots SET match_id = $2, updated_at = NOW() WHERE id = $1", [slot.id, match.rows[0].id]);
          changed = true;
        }
      } else if (slot.status === "BYE") {
        const parent = await client.query<{ id: string; home_source_slot_id: string | null; away_source_slot_id: string | null }>(
          `SELECT id, home_source_slot_id, away_source_slot_id FROM match_bracket_slots
           WHERE draw_version_id = $1 AND round_number = $2 AND position = $3 FOR UPDATE`,
          [drawVersionId, slot.round_number + 1, Math.ceil(slot.position / 2)],
        );
        if (parent.rowCount) {
          const side = parent.rows[0].home_source_slot_id === slot.id ? "home" : "away";
          const teamId = slot.home_team_id ?? slot.away_team_id;
          {
            await client.query(`UPDATE match_bracket_slots SET ${side}_team_id = $2, ${side}_resolved = TRUE, updated_at = NOW() WHERE id = $1`, [parent.rows[0].id, teamId]);
            const state = await client.query<{ home_team_id: string | null; away_team_id: string | null; home_resolved: boolean; away_resolved: boolean }>(
              "SELECT home_team_id, away_team_id, home_resolved, away_resolved FROM match_bracket_slots WHERE id=$1", [parent.rows[0].id],
            );
            const value = state.rows[0];
            if (value.home_resolved && value.away_resolved) {
              const nextStatus = value.home_team_id && value.away_team_id ? "READY" : "BYE";
              await client.query("UPDATE match_bracket_slots SET status=$2, winner_team_id=$3, updated_at=NOW() WHERE id=$1", [parent.rows[0].id, nextStatus, nextStatus === "BYE" ? value.home_team_id ?? value.away_team_id : null]);
            }
          }
          await client.query("UPDATE match_bracket_slots SET status = 'COMPLETED', updated_at = NOW() WHERE id = $1", [slot.id]);
          changed = true;
        }
      }
    }
    if (!changed) break;
    // Revisit READY parents once after BYE propagation to sync their preallocated Match IDs.
  }
}

export async function advanceApprovedKnockoutWinner(
  client: PoolClient,
  matchId: string,
  winnerTeamId: string,
): Promise<void> {
  const current = await client.query<{ id: string; tournament_id: string; draw_version_id: string; round_number: number; position: number; home_team_id: string | null; away_team_id: string | null }>(
    `SELECT id, tournament_id, draw_version_id, round_number, position, home_team_id, away_team_id FROM match_bracket_slots
     WHERE match_id = $1 FOR UPDATE`, [matchId],
  );
  if (!current.rowCount) return;
  const slot = current.rows[0];
  await client.query(
    "UPDATE match_bracket_slots SET winner_team_id = $2, status = 'COMPLETED', updated_at = NOW() WHERE match_id = $1",
    [matchId, winnerTeamId],
  );
  const loserTeamId = [slot.home_team_id, slot.away_team_id].find((teamId) => teamId && teamId !== winnerTeamId);
  if (loserTeamId) {
    const loserSources = await client.query<{ id: string; side: "HOME" | "AWAY"; home_resolved: boolean; away_resolved: boolean; home_team_id: string | null; away_team_id: string | null }>(
      `SELECT id,
              CASE WHEN home_source_slot_id=$2 AND home_source_outcome='LOSER' THEN 'HOME' ELSE 'AWAY' END AS side,
              home_resolved, away_resolved, home_team_id, away_team_id
       FROM match_bracket_slots
       WHERE draw_version_id=$1 AND slot_type='THIRD_PLACE'
         AND ((home_source_slot_id=$2 AND home_source_outcome='LOSER')
           OR (away_source_slot_id=$2 AND away_source_outcome='LOSER'))
       FOR UPDATE`, [slot.draw_version_id, slot.id],
    );
    for (const target of loserSources.rows) {
      const column = target.side === "HOME" ? "home" : "away";
      await client.query(`UPDATE match_bracket_slots SET ${column}_team_id=$2, ${column}_resolved=TRUE, updated_at=NOW() WHERE id=$1`, [target.id, loserTeamId]);
      const resolved = target.home_resolved && target.away_resolved || (target.side === "HOME" ? target.away_resolved : target.home_resolved);
      if (resolved) await client.query("UPDATE match_bracket_slots SET status='READY', updated_at=NOW() WHERE id=$1", [target.id]);
    }
  }
  const parent = await client.query<{ id: string; home_source_slot_id: string | null; away_source_slot_id: string | null }>(
    `SELECT id, home_source_slot_id, away_source_slot_id FROM match_bracket_slots
     WHERE draw_version_id = $1 AND round_number = $2 AND position = $3 FOR UPDATE`,
    [slot.draw_version_id, slot.round_number + 1, Math.ceil(slot.position / 2)],
  );
  if (parent.rowCount) {
    const side = parent.rows[0].home_source_slot_id === slot.id ? "home" : "away";
    await client.query(
      `UPDATE match_bracket_slots SET ${side}_team_id = $2, ${side}_resolved = TRUE, updated_at = NOW() WHERE id = $1`,
      [parent.rows[0].id, winnerTeamId],
    );
    const state = await client.query<{ home_team_id: string | null; away_team_id: string | null; home_resolved: boolean; away_resolved: boolean }>(
      "SELECT home_team_id, away_team_id, home_resolved, away_resolved FROM match_bracket_slots WHERE id=$1", [parent.rows[0].id],
    );
    const next = state.rows[0];
    if (next.home_resolved && next.away_resolved) {
      const nextStatus = next.home_team_id && next.away_team_id ? "READY" : "BYE";
      await client.query("UPDATE match_bracket_slots SET status=$2, winner_team_id=$3, updated_at=NOW() WHERE id=$1", [parent.rows[0].id, nextStatus, nextStatus === "BYE" ? next.home_team_id ?? next.away_team_id : null]);
    }
  }
  await resolveReadyBracketSlots(client, slot.tournament_id, slot.draw_version_id);
}

export async function listKnockoutBracket(tournamentId: string, publishedDrawVersionId?: string): Promise<Array<{
  id: string; roundNumber: number; position: number; homeTeamId: string | null; awayTeamId: string | null;
  homeSourceSlotId: string | null; awaySourceSlotId: string | null;
  winnerTeamId: string | null; matchId: string | null; matchStatus: string | null; status: string;
  homeQualification: { groupId: string; groupRank: number } | null;
  awayQualification: { groupId: string; groupRank: number } | null;
  slotType: "STANDARD" | "THIRD_PLACE";
  homeSourceOutcome: "WINNER" | "LOSER";
  awaySourceOutcome: "WINNER" | "LOSER";
}>> {
  const result = await getPool().query(
    `SELECT b.id, b.round_number, b.position, b.home_team_id, b.away_team_id, b.winner_team_id,
            b.match_id, m.status AS match_status, b.status, b.slot_type, b.home_source_slot_id, b.away_source_slot_id, b.home_source_outcome, b.away_source_outcome,
            home_source.group_id AS home_group_id, home_source.group_rank AS home_group_rank,
            away_source.group_id AS away_group_id, away_source.group_rank AS away_group_rank
     FROM match_bracket_slots b LEFT JOIN matches m ON m.id = b.match_id
     LEFT JOIN match_bracket_qualification_sources home_source ON home_source.slot_id=b.id AND home_source.side='HOME'
     LEFT JOIN match_bracket_qualification_sources away_source ON away_source.slot_id=b.id AND away_source.side='AWAY'
     JOIN match_fixture_generations g ON g.draw_version_id = b.draw_version_id AND g.stage='KNOCKOUT'
       WHERE b.tournament_id = $1 AND g.publication_status='PUBLISHED' AND b.draw_version_id = COALESCE($2::uuid, (
         SELECT draw_version_id FROM match_fixture_generations WHERE tournament_id = $1 AND publication_status='PUBLISHED' ORDER BY created_at DESC LIMIT 1
       )) ORDER BY b.round_number, b.position`, [tournamentId, publishedDrawVersionId ?? null],
  );
  return result.rows.map((row) => ({
    id: row.id, roundNumber: row.round_number, position: row.position,
    homeTeamId: row.home_team_id, awayTeamId: row.away_team_id,
    homeSourceSlotId: row.home_source_slot_id, awaySourceSlotId: row.away_source_slot_id,
    winnerTeamId: row.winner_team_id, matchId: row.match_id, matchStatus: row.match_status, status: row.status,
    homeQualification: row.home_group_id ? { groupId: row.home_group_id, groupRank: row.home_group_rank } : null,
    awayQualification: row.away_group_id ? { groupId: row.away_group_id, groupRank: row.away_group_rank } : null,
    slotType: row.slot_type ?? "STANDARD", homeSourceOutcome: row.home_source_outcome ?? "WINNER", awaySourceOutcome: row.away_source_outcome ?? "WINNER",
  }));
}

export async function listManagedKnockoutBracket(tournamentId: string): ReturnType<typeof listKnockoutBracket> {
  const result = await getPool().query(
    `SELECT b.id, b.round_number, b.position, b.home_team_id, b.away_team_id, b.winner_team_id,
            b.match_id, m.status AS match_status, b.status, b.slot_type, b.home_source_slot_id, b.away_source_slot_id, b.home_source_outcome, b.away_source_outcome,
            home_source.group_id AS home_group_id, home_source.group_rank AS home_group_rank,
            away_source.group_id AS away_group_id, away_source.group_rank AS away_group_rank
     FROM match_bracket_slots b LEFT JOIN matches m ON m.id=b.match_id
     LEFT JOIN match_bracket_qualification_sources home_source ON home_source.slot_id=b.id AND home_source.side='HOME'
     LEFT JOIN match_bracket_qualification_sources away_source ON away_source.slot_id=b.id AND away_source.side='AWAY'
     JOIN match_fixture_generations g ON g.draw_version_id=b.draw_version_id AND g.stage='KNOCKOUT'
     WHERE b.tournament_id=$1 AND b.draw_version_id=(
       SELECT draw_version_id FROM match_fixture_generations WHERE tournament_id=$1 ORDER BY created_at DESC LIMIT 1
     ) ORDER BY b.round_number,b.position`, [tournamentId],
  );
  return result.rows.map((row) => ({
    id: row.id, roundNumber: row.round_number, position: row.position,
    homeTeamId: row.home_team_id, awayTeamId: row.away_team_id, winnerTeamId: row.winner_team_id,
    homeSourceSlotId: row.home_source_slot_id, awaySourceSlotId: row.away_source_slot_id,
    matchId: row.match_id, matchStatus: row.match_status, status: row.status,
    homeQualification: row.home_group_id ? { groupId: row.home_group_id, groupRank: row.home_group_rank } : null,
    awayQualification: row.away_group_id ? { groupId: row.away_group_id, groupRank: row.away_group_rank } : null,
    slotType: row.slot_type ?? "STANDARD", homeSourceOutcome: row.home_source_outcome ?? "WINNER", awaySourceOutcome: row.away_source_outcome ?? "WINNER",
  }));
}

export async function getKnockoutMatchReadiness(matchId: string): Promise<{
  status: string; homeTeamId: string | null; awayTeamId: string | null; homeResolved: boolean; awayResolved: boolean;
} | null> {
  const result = await getPool().query(
    `SELECT status, home_team_id, away_team_id, home_resolved, away_resolved
     FROM match_bracket_slots WHERE match_id = $1`, [matchId],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { status: row.status, homeTeamId: row.home_team_id, awayTeamId: row.away_team_id,
    homeResolved: row.home_resolved, awayResolved: row.away_resolved };
}

export async function getKnockoutMatchPossibleEntrants(matchId: string): Promise<string[] | null> {
  const thirdPlace = await getPool().query<{ home_team_id: string | null; away_team_id: string | null }>(
    "SELECT home_team_id, away_team_id FROM match_bracket_slots WHERE match_id=$1 AND slot_type='THIRD_PLACE'", [matchId],
  );
  if (thirdPlace.rowCount) {
    return [thirdPlace.rows[0].home_team_id, thirdPlace.rows[0].away_team_id].filter((teamId): teamId is string => Boolean(teamId));
  }
  const result = await getPool().query<{ team_id: string }>(
    `WITH RECURSIVE descendants AS (
       SELECT id, home_source_slot_id, away_source_slot_id, home_team_id, away_team_id, winner_team_id
       FROM match_bracket_slots WHERE match_id = $1
       UNION ALL
       SELECT source.id, source.home_source_slot_id, source.away_source_slot_id, source.home_team_id, source.away_team_id, source.winner_team_id
       FROM match_bracket_slots source
       JOIN descendants parent ON parent.winner_team_id IS NULL
         AND (source.id = parent.home_source_slot_id OR source.id = parent.away_source_slot_id)
     ), participants AS (
       SELECT winner_team_id AS team_id FROM descendants WHERE winner_team_id IS NOT NULL
       UNION
       SELECT home_team_id AS team_id FROM descendants
         WHERE winner_team_id IS NULL AND home_source_slot_id IS NULL AND home_team_id IS NOT NULL
       UNION
       SELECT away_team_id AS team_id FROM descendants
         WHERE winner_team_id IS NULL AND away_source_slot_id IS NULL AND away_team_id IS NOT NULL
     ) SELECT team_id FROM participants`,
    [matchId],
  );
  if (!result.rowCount) {
    const slot = await getPool().query("SELECT 1 FROM match_bracket_slots WHERE match_id=$1", [matchId]);
    return slot.rowCount ? [] : null;
  }
  return result.rows.map((row) => row.team_id);
}

export async function updateMatch(id: string, input: MatchUpdateInput,expectedStatus?:string,actorId?:string): Promise<Match | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.matchDate !== undefined) {
    sets.push(`match_date = $${idx++}`);
    values.push(input.matchDate);
  }
  if (input.venue !== undefined) {
    sets.push(`venue = $${idx++}`);
    values.push(input.venue);
  }
  if (input.round !== undefined) {
    sets.push(`round = $${idx++}`);
    values.push(input.round);
  }
  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }

  if (sets.length === 0) {
    return findMatchById(id);
  }

  sets.push("updated_at = NOW()");
  values.push(id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ tournament_id: string;status:string }>(
      "SELECT tournament_id,status FROM matches WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const tournamentId = current.rows[0].tournament_id;
    if(expectedStatus&&current.rows[0].status!==expectedStatus)throw new AppError(409,"Trạng thái trận vừa thay đổi. Hãy tải lại trước khi quyết định.","MATCH_STATE_CONFLICT");
    if(input.status==="SCHEDULED"&&current.rows[0].status==="POSTPONED"){
      const played=await client.query("SELECT 1 FROM match_clock_states WHERE match_id=$1 AND phase<>'NOT_STARTED'",[id]);
      if(played.rowCount)throw new AppError(409,"Trận đã thi đấu một phần. Cần quyết định đá tiếp có thẩm quyền, không đưa về lịch mới để reset đồng hồ.","MATCH_CONTINUATION_DECISION_REQUIRED");
    }
    if(input.status==="POSTPONED"||input.status==="CANCELLED"){
      if(!actorId)throw new AppError(403,"Cần xác định người quyết định thay đổi trạng thái trận.","UNAUTHENTICATED");
      await freezeMatchClock(client,id,input.status,actorId,null);
    }
    await lockTournamentStandings(client, tournamentId);
    await client.query(`UPDATE matches SET ${sets.join(", ")} WHERE id = $${idx}`, values);
    await recalculateStandings(client, tournamentId);
    const updated = await client.query(
      `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round, status, created_at, updated_at
       FROM matches WHERE id = $1`,
      [id],
    );
    await publishMatchUpdate(client, id, "match.schedule-state.changed");
    await client.query("COMMIT");
    return updated.rowCount === 0 ? null : mapMatch(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteMatch(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM matches WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// Match Results
function mapMatchResult(row: {
  id: string;
  match_id: string;
  home_score: number;
  away_score: number;
  home_extra_time_score: number | null;
  away_extra_time_score: number | null;
  home_penalty_score: number | null;
  away_penalty_score: number | null;
  recorded_by: string;
  recorded_at: string;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
}): MatchResult {
  return {
    id: row.id,
    matchId: row.match_id,
    homeScore: row.home_score,
    awayScore: row.away_score,
    homeExtraTimeScore: row.home_extra_time_score,
    awayExtraTimeScore: row.away_extra_time_score,
    homePenaltyScore: row.home_penalty_score,
    awayPenaltyScore: row.away_penalty_score,
    recordedBy: row.recorded_by,
    recordedAt: row.recorded_at,
    notes: row.notes,
    status: row.status,
  };
}

function mapResultCorrectionRequest(row: {
  id: string; match_id: string; tournament_id: string; requested_by: string;
  original_result: MatchResultCorrectionRequest["originalResult"];
  proposed_result: MatchResultCorrectionRequest["proposedResult"];
  reason: string; status: "PENDING" | "APPROVED" | "REJECTED";
  reviewed_by: string | null; reviewed_at: string | null; review_reason: string | null; cascade_snapshot?: Array<{ matchId: string; previousHomeTeamId: string | null; previousAwayTeamId: string | null; nextHomeTeamId: string | null; nextAwayTeamId: string | null }>;
  created_at: string;
}): MatchResultCorrectionRequest {
  return {
    id: row.id, matchId: row.match_id, tournamentId: row.tournament_id, requestedBy: row.requested_by,
    originalResult: row.original_result, proposedResult: row.proposed_result, reason: row.reason,
    status: row.status, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    reviewReason: row.review_reason, cascadeSnapshot: row.cascade_snapshot ?? [], createdAt: row.created_at,
  };
}

const correctionProjection = `id, match_id, tournament_id, requested_by, original_result, proposed_result,
  reason, status, reviewed_by, reviewed_at, review_reason, cascade_snapshot, created_at`;

export async function findResultCorrectionRequest(id: string): Promise<MatchResultCorrectionRequest | null> {
  const result = await getPool().query(`SELECT ${correctionProjection} FROM match_result_correction_requests WHERE id=$1`, [id]);
  return result.rows[0] ? mapResultCorrectionRequest(result.rows[0]) : null;
}

export async function listResultCorrectionRequests(tournamentId: string, status?: string): Promise<MatchResultCorrectionRequest[]> {
  const result = await getPool().query(
    `SELECT ${correctionProjection} FROM match_result_correction_requests
     WHERE tournament_id=$1 AND ($2::text IS NULL OR status=$2)
     ORDER BY created_at DESC`, [tournamentId, status ?? null],
  );
  return result.rows.map(mapResultCorrectionRequest);
}

function winnerForCorrection(homeTeamId: string, awayTeamId: string, score: { homeScore: number; awayScore: number; homeExtraTimeScore?: number | null; awayExtraTimeScore?: number | null; homePenaltyScore?: number | null; awayPenaltyScore?: number | null }): string | null {
  if (score.homeScore !== score.awayScore) return score.homeScore > score.awayScore ? homeTeamId : awayTeamId;
  if (score.homeExtraTimeScore != null && score.awayExtraTimeScore != null && score.homeExtraTimeScore !== score.awayExtraTimeScore) {
    return score.homeExtraTimeScore > score.awayExtraTimeScore ? homeTeamId : awayTeamId;
  }
  if (score.homePenaltyScore != null && score.awayPenaltyScore != null && score.homePenaltyScore !== score.awayPenaltyScore) {
    return score.homePenaltyScore > score.awayPenaltyScore ? homeTeamId : awayTeamId;
  }
  return null;
}

type CorrectionCascadeRow = {
  id: string; round_number: number; position: number; home_source_slot_id: string | null; away_source_slot_id: string | null;
  home_team_id: string | null; away_team_id: string | null; winner_team_id: string | null; status: string; match_id: string | null;
  match_status: string | null; match_date: Date | null;
};

/**
 * Corrects an already advanced knockout winner without replacing any fixture IDs.
 * Only future, unscheduled descendants can be updated automatically. Once any
 * dependent fixture has been scheduled, lined up, reported, or played, the whole
 * correction transaction is rejected so BTC can resolve the operational impact first.
 */
async function applyKnockoutCorrectionCascade(
  client: PoolClient,
  matchId: string,
  proposedWinnerId: string | null,
  currentWinnerId: string | null,
): Promise<Array<{ matchId: string; previousHomeTeamId: string | null; previousAwayTeamId: string | null; nextHomeTeamId: string | null; nextAwayTeamId: string | null }>> {
  const sourceResult = await client.query<CorrectionCascadeRow>(
    `SELECT slot.id, slot.round_number, slot.position, slot.home_source_slot_id, slot.away_source_slot_id,
            slot.home_team_id, slot.away_team_id, slot.winner_team_id, slot.status, slot.match_id,
            match.status AS match_status, match.match_date
     FROM match_bracket_slots slot LEFT JOIN matches match ON match.id=slot.match_id
     WHERE slot.match_id=$1 FOR UPDATE OF slot`, [matchId],
  );
  if (!sourceResult.rowCount) return [];
  if (!proposedWinnerId) {
    throw new AppError(409, "The corrected result does not determine a winner under this tournament's rules; a BTC incident decision is required", "CORRECTION_WINNER_UNRESOLVED");
  }
  const source = sourceResult.rows[0];
  if (![source.home_team_id, source.away_team_id].includes(proposedWinnerId)) {
    throw new AppError(409, "The correction winner is not a participant in this fixture", "CORRECTION_WINNER_OUTSIDE_FIXTURE");
  }
  if (!currentWinnerId || source.winner_team_id !== currentWinnerId) {
    throw new AppError(409, "The bracket winner does not match the current official result; reconcile the bracket before correcting this result", "BRACKET_RESULT_STATE_MISMATCH");
  }
  if (source.winner_team_id === proposedWinnerId) return [];

  const allSlotsResult = await client.query<CorrectionCascadeRow>(
    `SELECT slot.id, slot.round_number, slot.position, slot.home_source_slot_id, slot.away_source_slot_id,
            slot.home_team_id, slot.away_team_id, slot.winner_team_id, slot.status, slot.match_id,
            match.status AS match_status, match.match_date
     FROM match_bracket_slots slot LEFT JOIN matches match ON match.id=slot.match_id
     WHERE slot.draw_version_id=(SELECT draw_version_id FROM match_bracket_slots WHERE id=$1)
     ORDER BY slot.round_number, slot.position FOR UPDATE OF slot`, [source.id],
  );
  const descendants = new Set<string>([source.id]);
  const impacted = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const slot of allSlotsResult.rows) {
      if (descendants.has(slot.id)) continue;
      if ((slot.home_source_slot_id && descendants.has(slot.home_source_slot_id)) ||
          (slot.away_source_slot_id && descendants.has(slot.away_source_slot_id))) {
        descendants.add(slot.id);
        impacted.add(slot.id);
        changed = true;
      }
    }
  }
  const impactedRows = allSlotsResult.rows.filter((slot) => impacted.has(slot.id));
  for (const slot of impactedRows) {
    if (slot.status === "COMPLETED" || slot.status === "BYE" || slot.winner_team_id) {
      throw new AppError(409, "A dependent bracket position has already been resolved; open a formal tournament incident before changing this result", "CORRECTION_CASCADE_ALREADY_RESOLVED");
    }
    if (!slot.match_id) continue;
    if (slot.match_status !== "UNSCHEDULED" || slot.match_date) {
      throw new AppError(409, "A dependent match already has a schedule or has started. Resolve and publish the replacement schedule before applying this correction", "CORRECTION_CASCADE_REQUIRES_RESCHEDULE");
    }
    // Scheduling is a separate database. Fail closed if a schedule row exists
    // even when the Match-side schedule projection is stale or not yet synced.
    // Load the scheduling repository only for this cross-database guard. A
    // static import initializes the Scheduling pool during unrelated Match
    // tests/commands and incorrectly requires SCHEDULING_DATABASE_URL there.
    const { findScheduleByMatchId } = await import("../scheduling/repositories/schedulingRepository");
    if (await findScheduleByMatchId(slot.match_id)) {
      throw new AppError(409, "A dependent match has a schedule record. Resolve the schedule before applying this correction", "CORRECTION_CASCADE_REQUIRES_RESCHEDULE");
    }
    const activity = await client.query(
      `SELECT 1 WHERE EXISTS (SELECT 1 FROM match_results WHERE match_id=$1)
        OR EXISTS (SELECT 1 FROM lineups WHERE match_id=$1)
        OR EXISTS (SELECT 1 FROM match_reports WHERE match_id=$1)
        OR EXISTS (SELECT 1 FROM match_events WHERE match_id=$1 AND voided_at IS NULL)
        OR EXISTS (SELECT 1 FROM match_clock_states WHERE match_id=$1)`, [slot.match_id],
    );
    if (activity.rowCount) {
      throw new AppError(409, "A dependent match already has lineup, report, event, clock, or result data; it must be reviewed as a tournament incident", "CORRECTION_CASCADE_HAS_ACTIVITY");
    }
  }

  const parent = impactedRows.find((slot) => slot.home_source_slot_id === source.id || slot.away_source_slot_id === source.id);
  if (!parent) return [];
  const side = parent.home_source_slot_id === source.id ? "home" : "away";
  const previousHomeTeamId = parent.home_team_id;
  const previousAwayTeamId = parent.away_team_id;
  const nextHomeTeamId = side === "home" ? proposedWinnerId : parent.home_team_id;
  const nextAwayTeamId = side === "away" ? proposedWinnerId : parent.away_team_id;
  if (nextHomeTeamId && nextAwayTeamId && nextHomeTeamId === nextAwayTeamId) {
    throw new AppError(409, "The corrected winner would create a duplicate team in the next match", "CORRECTION_CASCADE_DUPLICATE_TEAM");
  }
  await client.query(
    `UPDATE match_bracket_slots SET ${side}_team_id=$2, winner_team_id=NULL,
       status=CASE WHEN home_resolved AND away_resolved THEN 'READY' ELSE 'WAITING' END, updated_at=NOW()
     WHERE id=$1`, [parent.id, proposedWinnerId],
  );
  if (parent.match_id) {
    const updated = await client.query(
      `UPDATE matches SET home_team_id=$2, away_team_id=$3, updated_at=NOW()
       WHERE id=$1 AND status='UNSCHEDULED' AND match_date IS NULL`,
      [parent.match_id, nextHomeTeamId, nextAwayTeamId],
    );
    if (!updated.rowCount) throw new AppError(409, "The dependent match changed while the correction was being reviewed; reload the bracket and retry", "CORRECTION_CASCADE_STATE_CHANGED");
    await publishMatchUpdate(client, parent.match_id, "bracket.participant.corrected");
  }
  return parent.match_id ? [{ matchId: parent.match_id, previousHomeTeamId, previousAwayTeamId, nextHomeTeamId, nextAwayTeamId }] : [];
}

export async function createResultCorrectionRequest(input: {
  matchId: string; proposal: Omit<MatchResultCreateInput, "matchId">; reason: string; requestedBy: string;
}): Promise<MatchResultCorrectionRequest> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const matchResult = await client.query<{
      tournament_id: string; status: string; home_team_id: string; away_team_id: string;
      draw_version_id: string | null; group_id: string | null;
    }>("SELECT tournament_id,status,home_team_id,away_team_id,draw_version_id,group_id FROM matches WHERE id=$1 FOR UPDATE", [input.matchId]);
    const match = matchResult.rows[0];
    if (!match) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
    if (match.status !== "VERIFIED") throw new AppError(409, "Only a BTC-approved result can be corrected", "RESULT_NOT_APPROVED");
    const currentResult = await client.query<{
      id: string; match_id: string; home_score: number; away_score: number; home_extra_time_score: number | null;
      away_extra_time_score: number | null; home_penalty_score: number | null; away_penalty_score: number | null;
      recorded_by: string; recorded_at: string; notes: string | null; status: "APPROVED" | "PENDING" | "REJECTED";
    }>(`SELECT id,match_id,home_score,away_score,home_extra_time_score,away_extra_time_score,
        home_penalty_score,away_penalty_score,recorded_by,recorded_at,notes,status
        FROM match_results WHERE match_id=$1 FOR UPDATE`, [input.matchId]);
    if (!currentResult.rowCount || currentResult.rows[0].status !== "APPROVED") throw new AppError(409, "Approved result record was not found", "RESULT_NOT_APPROVED");
    const existingPending = await client.query("SELECT 1 FROM match_result_correction_requests WHERE match_id=$1 AND status='PENDING'", [input.matchId]);
    if (existingPending.rowCount) throw new AppError(409, "A correction request is already awaiting review", "CORRECTION_ALREADY_PENDING");
    if (match.draw_version_id && match.group_id) {
      const playoff = await client.query("SELECT 1 FROM match_knockout_qualifications WHERE tournament_id=$1 AND draw_version_id=$2 LIMIT 1", [match.tournament_id, match.draw_version_id]);
      if (playoff.rowCount) throw new AppError(409, "Group-stage results cannot be corrected after playoff qualifiers are locked", "PLAYOFF_QUALIFIERS_LOCKED");
    }
    const current = mapMatchResult(currentResult.rows[0]);
    const originalResult = {
      matchId: current.matchId, homeScore: current.homeScore, awayScore: current.awayScore,
      homeExtraTimeScore: current.homeExtraTimeScore, awayExtraTimeScore: current.awayExtraTimeScore,
      homePenaltyScore: current.homePenaltyScore, awayPenaltyScore: current.awayPenaltyScore, notes: current.notes,
    };
    const inserted = await client.query(
      `INSERT INTO match_result_correction_requests
       (match_id,tournament_id,requested_by,original_result,proposed_result,reason)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING ${correctionProjection}`,
      [input.matchId, match.tournament_id, input.requestedBy, JSON.stringify(originalResult), JSON.stringify(input.proposal), input.reason.trim()],
    );
    await client.query("COMMIT");
    return mapResultCorrectionRequest(inserted.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function reviewResultCorrectionRequest(id: string, decision: "APPROVED" | "REJECTED", reviewerId: string, reviewReason: string): Promise<MatchResultCorrectionRequest> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query<Parameters<typeof mapResultCorrectionRequest>[0]>(`SELECT ${correctionProjection} FROM match_result_correction_requests WHERE id=$1 FOR UPDATE`, [id]);
    const request = requestResult.rows[0];
    if (!request) throw new AppError(404, "Correction request not found", "CORRECTION_REQUEST_NOT_FOUND");
    if (request.status !== "PENDING") throw new AppError(409, "Correction request has already been decided", "CORRECTION_ALREADY_DECIDED");
    if (decision === "REJECTED" && reviewReason.trim().length < 5) throw new AppError(400, "A reason is required to reject a correction", "DECISION_REASON_REQUIRED");
    if (decision === "APPROVED") {
      const matchResult = await client.query<{ status: string; home_team_id: string; away_team_id: string }>("SELECT status,home_team_id,away_team_id FROM matches WHERE id=$1 FOR UPDATE", [request.match_id]);
      const currentResult = await client.query<any>("SELECT * FROM match_results WHERE match_id=$1 FOR UPDATE", [request.match_id]);
      const current = currentResult.rows[0];
      const original = request.original_result;
      if (matchResult.rows[0]?.status !== "VERIFIED" || current?.status !== "APPROVED" ||
        current.home_score !== original.homeScore || current.away_score !== original.awayScore ||
        current.home_extra_time_score !== original.homeExtraTimeScore || current.away_extra_time_score !== original.awayExtraTimeScore ||
        current.home_penalty_score !== original.homePenaltyScore || current.away_penalty_score !== original.awayPenaltyScore) {
        throw new AppError(409, "The official result changed since this request was submitted", "RESULT_SNAPSHOT_CONFLICT");
      }
      const proposal = request.proposed_result;
      assertResultRulePolicy(await getEffectiveMatchRules(request.match_id,client),proposal,true);
      const proposedWinner = winnerForCorrection(matchResult.rows[0].home_team_id, matchResult.rows[0].away_team_id, proposal);
      const currentWinner = winnerForCorrection(
        matchResult.rows[0].home_team_id,
        matchResult.rows[0].away_team_id,
        mapMatchResult(current),
      );
      const cascadeSnapshot = await applyKnockoutCorrectionCascade(client, request.match_id, proposedWinner, currentWinner);
      await client.query(
        `UPDATE match_results SET home_score=$2,away_score=$3,home_extra_time_score=$4,away_extra_time_score=$5,
         home_penalty_score=$6,away_penalty_score=$7,notes=$8,recorded_by=$9,recorded_at=NOW()
         WHERE match_id=$1`,
        [request.match_id, proposal.homeScore, proposal.awayScore, proposal.homeExtraTimeScore ?? null,
          proposal.awayExtraTimeScore ?? null, proposal.homePenaltyScore ?? null, proposal.awayPenaltyScore ?? null,
          proposal.notes ?? null, reviewerId],
      );
      await lockTournamentStandings(client, request.tournament_id);
      await recalculateStandings(client, request.tournament_id);
      await client.query(
        "UPDATE match_bracket_slots SET winner_team_id=$2, updated_at=NOW() WHERE match_id=$1",
        [request.match_id, proposedWinner],
      );
      await publishMatchUpdate(client, request.match_id, "match.result.corrected");
      await client.query("UPDATE match_result_correction_requests SET cascade_snapshot=$2::jsonb WHERE id=$1", [id, JSON.stringify(cascadeSnapshot)]);
    }
    const updated = await client.query(
      `UPDATE match_result_correction_requests SET status=$2,reviewed_by=$3,reviewed_at=NOW(),review_reason=$4
       WHERE id=$1 RETURNING ${correctionProjection}`,
      [id, decision, reviewerId, reviewReason.trim() || null],
    );
    await client.query("COMMIT");
    return mapResultCorrectionRequest(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function findMatchResultByMatchId(matchId: string): Promise<MatchResult | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, match_id, home_score, away_score, home_extra_time_score, away_extra_time_score,
            home_penalty_score, away_penalty_score, recorded_by, recorded_at, notes, status
     FROM match_results
     WHERE match_id = $1`,
    [matchId],
  );

  if (result.rowCount === 0) return null;
  return mapMatchResult(result.rows[0]);
}

export async function createMatchResult(input: MatchResultCreateInput, recordedBy: string): Promise<MatchResult> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO match_results (match_id, home_score, away_score, home_extra_time_score, away_extra_time_score,
                              home_penalty_score, away_penalty_score, recorded_by, notes, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
     RETURNING id, match_id, home_score, away_score, home_extra_time_score, away_extra_time_score,
              home_penalty_score, away_penalty_score, recorded_by, recorded_at, notes, status`,
    [
      input.matchId,
      input.homeScore,
      input.awayScore,
      input.homeExtraTimeScore ?? null,
      input.awayExtraTimeScore ?? null,
      input.homePenaltyScore ?? null,
      input.awayPenaltyScore ?? null,
      recordedBy,
      input.notes ?? null,
    ],
  );

  return mapMatchResult(result.rows[0]);
}

export async function updateMatchResult(id: string, input: MatchResultCreateInput, recordedBy: string): Promise<MatchResult | null> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE match_results
     SET home_score = $2, away_score = $3, home_extra_time_score = $4, away_extra_time_score = $5,
         home_penalty_score = $6, away_penalty_score = $7, recorded_by = $8, notes = $9, recorded_at = NOW(), status = 'PENDING'
     WHERE id = $1
     RETURNING id, match_id, home_score, away_score, home_extra_time_score, away_extra_time_score,
              home_penalty_score, away_penalty_score, recorded_by, recorded_at, notes, status`,
    [
      id,
      input.homeScore,
      input.awayScore,
      input.homeExtraTimeScore ?? null,
      input.awayExtraTimeScore ?? null,
      input.homePenaltyScore ?? null,
      input.awayPenaltyScore ?? null,
      recordedBy,
      input.notes ?? null,
    ],
  );

  if (result.rowCount === 0) return null;
  return mapMatchResult(result.rows[0]);
}

export async function recordMatchResultAndRecalculate(
  input: MatchResultCreateInput,
  recordedBy: string,
): Promise<MatchResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const matchResult = await client.query<{
      id: string;
      tournament_id: string;
      status: string;
    }>(
      `SELECT id, tournament_id, status FROM matches WHERE id = $1 FOR UPDATE`,
      [input.matchId],
    );
    const match = matchResult.rows[0];
    if (!match) {
      throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
    }
    if (match.status !== "FINISHED" && match.status !== "VERIFIED") {
      throw new AppError(400, "Match must be finished before recording result", "MATCH_NOT_FINISHED");
    }
      if (match.status === "VERIFIED") {
        throw new AppError(409, "An approved result is immutable; submit a result-correction request for the organizer to review", "RESULT_CORRECTION_REQUEST_REQUIRED");
      }

    await assertRecordedOutcome(client,input.matchId,input);
      await lockTournamentStandings(client, match.tournament_id);
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM match_results WHERE match_id = $1 FOR UPDATE",
      [input.matchId],
    );
    const values = [
      input.homeScore,
      input.awayScore,
      input.homeExtraTimeScore ?? null,
      input.awayExtraTimeScore ?? null,
      input.homePenaltyScore ?? null,
      input.awayPenaltyScore ?? null,
      recordedBy,
      input.notes ?? null,
    ];
    const saved = existing.rows[0]
      ? await client.query(
          `UPDATE match_results
           SET home_score = $1, away_score = $2, home_extra_time_score = $3, away_extra_time_score = $4,
               home_penalty_score = $5, away_penalty_score = $6, recorded_by = $7, notes = $8,
               recorded_at = NOW(), status = 'PENDING'
           WHERE id = $9
           RETURNING id, match_id, home_score, away_score, home_extra_time_score, away_extra_time_score,
                     home_penalty_score, away_penalty_score, recorded_by, recorded_at, notes, status`,
          [...values, existing.rows[0].id],
        )
      : await client.query(
          `INSERT INTO match_results (
             match_id, home_score, away_score, home_extra_time_score, away_extra_time_score,
             home_penalty_score, away_penalty_score, recorded_by, notes, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING')
           RETURNING id, match_id, home_score, away_score, home_extra_time_score, away_extra_time_score,
                     home_penalty_score, away_penalty_score, recorded_by, recorded_at, notes, status`,
          [input.matchId, ...values],
        );

    await recalculateStandings(client, match.tournament_id);
    await publishMatchUpdate(client, input.matchId, "match.result.changed");
    await client.query("COMMIT");
    return mapMatchResult(saved.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordForfeitResult(
  input: { matchId: string; forfeitingTeamId: string; reason: string; winnerScore: number; loserScore: number; policy: string },
  decidedBy: string,
): Promise<{ decision: { id: string; matchId: string; tournamentId: string; forfeitingTeamId: string; winnerTeamId: string; reason: string; policy: string; decidedBy: string; createdAt: string }; result: MatchResult; alreadyApplied: boolean }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{
      id: string; tournament_id: string; home_team_id: string; away_team_id: string; status: string;
    }>("SELECT id,tournament_id,home_team_id,away_team_id,status FROM matches WHERE id=$1 FOR UPDATE", [input.matchId]);
    const match = found.rows[0];
    if (!match) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
    const prior = await client.query<{
      id: string; tournament_id: string; forfeiting_team_id: string; winner_team_id: string; reason: string;
      policy: string; decided_by: string; created_at: string;
    }>("SELECT id,tournament_id,forfeiting_team_id,winner_team_id,reason,policy,decided_by,created_at FROM match_forfeit_decisions WHERE match_id=$1 FOR UPDATE", [input.matchId]);
    if (prior.rowCount) {
      const saved = prior.rows[0];
      if (saved.forfeiting_team_id !== input.forfeitingTeamId || saved.reason !== input.reason.trim()
        || saved.policy !== input.policy || saved.decided_by !== decidedBy) {
        throw new AppError(409, "A different forfeit decision already exists for this match", "FORFEIT_ALREADY_DECIDED");
      }
      const existingResult = await client.query("SELECT id,match_id,home_score,away_score,home_extra_time_score,away_extra_time_score,home_penalty_score,away_penalty_score,recorded_by,recorded_at,notes,status FROM match_results WHERE match_id=$1", [input.matchId]);
      if (!existingResult.rowCount) throw new AppError(500, "Forfeit audit exists without its official result", "FORFEIT_RESULT_INCONSISTENT");
      await client.query("COMMIT");
      return {
        decision: { id: saved.id, matchId: input.matchId, tournamentId: saved.tournament_id, forfeitingTeamId: saved.forfeiting_team_id, winnerTeamId: saved.winner_team_id, reason: saved.reason, policy: saved.policy, decidedBy: saved.decided_by, createdAt: saved.created_at },
        result: mapMatchResult(existingResult.rows[0]),
        alreadyApplied: true,
      };
    }
    if (!["SCHEDULED", "LINEUP_CONFIRMED"].includes(match.status)) {
      throw new AppError(409, "A forfeit can only be recorded before the match starts", "MATCH_NOT_FORFEITABLE");
    }
    if (![match.home_team_id, match.away_team_id].includes(input.forfeitingTeamId)) {
      throw new AppError(400, "The forfeiting team must be assigned to this match", "MATCH_TEAM_MISMATCH");
    }
    if (input.winnerScore <= input.loserScore) throw new AppError(400, "Configured forfeit score must produce a winner", "INVALID_FORFEIT_SCORE");
    const resultExists = await client.query("SELECT 1 FROM match_results WHERE match_id=$1 FOR UPDATE", [input.matchId]);
    if (resultExists.rowCount) throw new AppError(409, "A result already exists for this match", "RESULT_ALREADY_RECORDED");

    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [match.tournament_id]);
    const winnerTeamId = input.forfeitingTeamId === match.home_team_id ? match.away_team_id : match.home_team_id;
    const homeWon = winnerTeamId === match.home_team_id;
    const homeScore = homeWon ? input.winnerScore : input.loserScore;
    const awayScore = homeWon ? input.loserScore : input.winnerScore;
    const audit = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO match_forfeit_decisions (match_id,tournament_id,forfeiting_team_id,winner_team_id,reason,policy,home_score,away_score,decided_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,created_at`,
      [input.matchId, match.tournament_id, input.forfeitingTeamId, winnerTeamId, input.reason.trim(), input.policy, homeScore, awayScore, decidedBy],
    );
    const result = await client.query(
      `INSERT INTO match_results (match_id,home_score,away_score,recorded_by,notes,status)
       VALUES ($1,$2,$3,$4,$5,'APPROVED')
       RETURNING id,match_id,home_score,away_score,home_extra_time_score,away_extra_time_score,home_penalty_score,away_penalty_score,recorded_by,recorded_at,notes,status`,
      [input.matchId, homeScore, awayScore, decidedBy, `FORFEIT (${input.policy}): ${input.reason.trim()}`],
    );
    await client.query("UPDATE matches SET status='VERIFIED',updated_at=NOW() WHERE id=$1", [input.matchId]);
    await advanceApprovedKnockoutWinner(client, input.matchId, winnerTeamId);
    await recalculateStandings(client, match.tournament_id);
    await client.query("COMMIT");
    return {
      decision: { id: audit.rows[0].id, matchId: input.matchId, tournamentId: match.tournament_id, forfeitingTeamId: input.forfeitingTeamId, winnerTeamId, reason: input.reason.trim(), policy: input.policy, decidedBy, createdAt: audit.rows[0].created_at },
      result: mapMatchResult(result.rows[0]),
      alreadyApplied: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function listTournamentForfeitDecisions(tournamentId: string): Promise<Array<{
  id: string; matchId: string; forfeitingTeamId: string; winnerTeamId: string; reason: string;
  policy: string; homeScore: number; awayScore: number; decidedBy: string; createdAt: string;
}>> {
  const result = await getPool().query(
    `SELECT id,match_id,forfeiting_team_id,winner_team_id,reason,policy,home_score,away_score,decided_by,created_at
     FROM match_forfeit_decisions WHERE tournament_id=$1 ORDER BY created_at DESC`, [tournamentId],
  );
  return result.rows.map((row) => ({
    id: row.id, matchId: row.match_id, forfeitingTeamId: row.forfeiting_team_id,
    winnerTeamId: row.winner_team_id, reason: row.reason, policy: row.policy,
    homeScore: row.home_score, awayScore: row.away_score, decidedBy: row.decided_by,
    createdAt: row.created_at,
  }));
}

// Standings
function mapStanding(row: {
  id: string;
  tournament_id: string;
  team_id: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  updated_at: string;
}): Standing {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    teamId: row.team_id,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goalsFor: row.goals_for,
    goalsAgainst: row.goals_against,
    goalDifference: row.goal_difference,
    points: row.points,
    updatedAt: row.updated_at,
  };
}

export async function listStandings(tournamentId: string): Promise<Standing[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, team_id, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, updated_at
     FROM standings
     WHERE tournament_id = $1
     ORDER BY points DESC, goal_difference DESC, goals_for DESC`,
    [tournamentId],
  );

  return result.rows.map(mapStanding);
}

export async function findStanding(tournamentId: string, teamId: string): Promise<Standing | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, team_id, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, updated_at
     FROM standings
     WHERE tournament_id = $1 AND team_id = $2`,
    [tournamentId, teamId],
  );

  if (result.rowCount === 0) return null;
  return mapStanding(result.rows[0]);
}

export async function createStanding(tournamentId: string, teamId: string): Promise<Standing> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO standings (tournament_id, team_id)
     VALUES ($1, $2)
     RETURNING id, tournament_id, team_id, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, updated_at`,
    [tournamentId, teamId],
  );

  return mapStanding(result.rows[0]);
}

export async function updateStanding(tournamentId: string, teamId: string, input: StandingUpdateInput): Promise<Standing | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.played !== undefined) {
    sets.push(`played = $${idx++}`);
    values.push(input.played);
  }
  if (input.won !== undefined) {
    sets.push(`won = $${idx++}`);
    values.push(input.won);
  }
  if (input.drawn !== undefined) {
    sets.push(`drawn = $${idx++}`);
    values.push(input.drawn);
  }
  if (input.lost !== undefined) {
    sets.push(`lost = $${idx++}`);
    values.push(input.lost);
  }
  if (input.goalsFor !== undefined) {
    sets.push(`goals_for = $${idx++}`);
    values.push(input.goalsFor);
  }
  if (input.goalsAgainst !== undefined) {
    sets.push(`goals_against = $${idx++}`);
    values.push(input.goalsAgainst);
  }
  if (input.goalDifference !== undefined) {
    sets.push(`goal_difference = $${idx++}`);
    values.push(input.goalDifference);
  }
  if (input.points !== undefined) {
    sets.push(`points = $${idx++}`);
    values.push(input.points);
  }

  if (sets.length === 0) {
    return findStanding(tournamentId, teamId);
  }

  sets.push("updated_at = NOW()");
  values.push(tournamentId, teamId);

  await pool.query(
    `UPDATE standings SET ${sets.join(", ")} WHERE tournament_id = $${idx} AND team_id = $${idx + 1}`,
    values,
  );

  return findStanding(tournamentId, teamId);
}

import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import type { MatchClockAction, MatchClockPhase, MatchClockState } from "../models/match";
import { accrueClock, assertMatchStartPrerequisites, transitionMatchClock } from "../services/matchClockWorkflow";
import { publishMatchUpdate } from "../realtime/matchRealtime";
import { assertClockRuleAction, getEffectiveMatchRules } from "../services/matchOperationRulesService";

type ClockRow = {
  match_id: string; phase: MatchClockPhase; elapsed_seconds: number; total_elapsed_seconds: number;
  is_running: boolean; started_at: Date | null; updated_by: string | null; updated_at: Date; version: number;
};

function mapClock(row: ClockRow, now = new Date()): MatchClockState {
  const elapsed = accrueClock(row.elapsed_seconds, row.total_elapsed_seconds, row.is_running ? row.started_at : null, now);
  return {
    matchId: row.match_id, phase: row.phase, elapsedSeconds: elapsed.elapsedSeconds,
    totalElapsedSeconds: elapsed.totalElapsedSeconds, isRunning: row.is_running,
    startedAt: row.started_at?.toISOString() ?? null, updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(), version: row.version,
  };
}

async function selectClock(client: PoolClient, matchId: string): Promise<ClockRow> {
  const matchResult = await client.query<{ id: string; status: string; updated_at: Date }>(
    "SELECT id, status, updated_at FROM matches WHERE id = $1 FOR UPDATE", [matchId],
  );
  const match = matchResult.rows[0];
  if (!match) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  let clock = await client.query<ClockRow>("SELECT * FROM match_clock_states WHERE match_id = $1 FOR UPDATE", [matchId]);
  if (!clock.rowCount) {
    const legacyInProgress = match.status === "IN_PROGRESS";
    clock = await client.query<ClockRow>(
      `INSERT INTO match_clock_states (match_id, phase, elapsed_seconds, total_elapsed_seconds, is_running, started_at, updated_at, version)
       VALUES ($1, $2, 0, 0, $3, $4, NOW(), 0) RETURNING *`,
      [matchId, legacyInProgress ? "FIRST_HALF" : "NOT_STARTED", legacyInProgress, legacyInProgress ? match.updated_at : null],
    );
  }
  return clock.rows[0];
}

export async function getMatchClock(matchId: string): Promise<MatchClockState> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const row = await selectClock(client, matchId);
    await client.query("COMMIT");
    return mapClock(row);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function applyMatchClockAction(
  matchId: string,
  action: MatchClockAction,
  expectedVersion: number,
  actorId: string,
): Promise<MatchClockState> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const matchResult = await client.query<{ id: string; status: string; home_team_id: string | null; away_team_id: string | null }>(
      "SELECT id, status, home_team_id, away_team_id FROM matches WHERE id = $1 FOR UPDATE", [matchId],
    );
    const match = matchResult.rows[0];
    if (!match) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
    const clockResult = await client.query<ClockRow>("SELECT * FROM match_clock_states WHERE match_id = $1 FOR UPDATE", [matchId]);
    const row = clockResult.rows[0] ?? (await selectClock(client, matchId));
    if (row.version !== expectedVersion) throw new AppError(409, "Đồng hồ đã được cập nhật ở thiết bị khác. Hãy tải trạng thái mới trước khi thao tác.", "CLOCK_VERSION_CONFLICT");
    if (["START_MATCH", "START_EXTRA_TIME", "START_PENALTIES"].includes(action)) {
      assertClockRuleAction(await getEffectiveMatchRules(matchId, client), action, row.phase);
    }
    if (action === "START_MATCH" && match.status !== "LINEUP_CONFIRMED") {
      throw new AppError(409, "Chỉ bắt đầu trận sau khi trọng tài xác nhận sẵn sàng đội hình.", "MATCH_NOT_READY");
    }
    if (action === "START_MATCH") {
      const schedule = await client.query<{ id: string }>(
        "SELECT id FROM schedules WHERE match_id = $1 AND status = 'PUBLISHED' ORDER BY updated_at DESC LIMIT 1 FOR SHARE",
        [matchId],
      );
      let assignmentCount = 0;
      let finalAuthorityCount = 0;
      if (schedule.rowCount) {
        const officials = await client.query<{ assignment_count: number; final_authority_count: number }>(
          `SELECT COUNT(*)::int AS assignment_count,
                  COUNT(*) FILTER (WHERE is_final_authority = TRUE)::int AS final_authority_count
           FROM schedule_referee_assignments
           WHERE schedule_id = $1 AND is_active = TRUE`,
          [schedule.rows[0].id],
        );
        assignmentCount = Number(officials.rows[0]?.assignment_count ?? 0);
        finalAuthorityCount = Number(officials.rows[0]?.final_authority_count ?? 0);
      }
      assertMatchStartPrerequisites({
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
        hasPublishedSchedule: Boolean(schedule.rowCount),
        publishedOfficialCount: assignmentCount,
        finalAuthorityCount,
      });
    }
    if (action !== "START_MATCH" && row.phase === "NOT_STARTED") {
      throw new AppError(409, "Trận chưa bắt đầu.", "MATCH_NOT_STARTED");
    }
    const now = new Date();
    const priorStartedAt = row.is_running && row.started_at ? new Date(row.started_at) : null;
    const accrued = accrueClock(row.elapsed_seconds, row.total_elapsed_seconds, priorStartedAt, now);
    const next = transitionMatchClock(row.phase, row.is_running, action);
    const startAt = next.isRunning ? (row.is_running ? row.started_at : now) : null;
    const saved = await client.query<ClockRow>(
      `UPDATE match_clock_states
       SET phase = $2, elapsed_seconds = $3, total_elapsed_seconds = $4,
           is_running = $5, started_at = $6, updated_by = $7, updated_at = NOW(), version = version + 1
       WHERE match_id = $1 AND version = $8 RETURNING *`,
      [matchId, next.phase, next.phase === row.phase ? accrued.elapsedSeconds : 0,
        accrued.totalElapsedSeconds, next.isRunning, startAt, actorId, expectedVersion],
    );
    if (!saved.rowCount) throw new AppError(409, "Đồng hồ vừa được cập nhật ở thiết bị khác.", "CLOCK_VERSION_CONFLICT");
    if (next.matchStatus) {
      const update = await client.query("UPDATE matches SET status = $2, updated_at = NOW() WHERE id = $1 AND status = $3", [matchId, next.matchStatus, match.status]);
      if (!update.rowCount) throw new AppError(409, "Trạng thái trận vừa thay đổi ở thiết bị khác.", "MATCH_STATE_CONFLICT");
      await publishMatchUpdate(client, matchId, "match.status.changed");
    }
    await publishMatchUpdate(client, matchId, "match.clock.changed");
    await client.query("COMMIT");
    return mapClock(saved.rows[0], now);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

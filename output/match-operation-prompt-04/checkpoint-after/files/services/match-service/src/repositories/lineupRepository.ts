import type {
  Lineup,
  MatchEvent,
  MatchEventCreateInput,
  MatchReport,
  MatchReportCreateInput,
  MatchReportSubmissionSnapshot,
  MatchReportUpdateInput,
} from "../models/match";
import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import { advanceApprovedKnockoutWinner, recalculateStandings } from "./matchRepository";
import { publishMatchUpdate } from "../realtime/matchRealtime";

// Lineups
function mapLineup(row: {
  id: string;
  match_id: string;
  team_id: string;
  player_id: string;
  position: string | null;
  jersey_number: number | null;
  is_starting: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}): Lineup {
  return {
    id: row.id,
    matchId: row.match_id,
    teamId: row.team_id,
    playerId: row.player_id,
    position: row.position,
    jerseyNumber: row.jersey_number,
    isStarting: row.is_starting,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

export async function listLineups(matchId: string, teamId?: string): Promise<Lineup[]> {
  const pool = getPool();
  let query = `
    SELECT id, match_id, team_id, player_id, position, jersey_number, is_starting, confirmed_by, confirmed_at, created_at
    FROM lineups
    WHERE match_id = $1
  `;
  const params: unknown[] = [matchId];

  if (teamId) {
    query += ` AND team_id = $2`;
    params.push(teamId);
  }

  query += ` ORDER BY is_starting DESC, jersey_number ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapLineup);
}

// Match Events
function mapMatchEvent(row: {
  id: string;
  match_id: string;
  team_id: string;
  player_id: string | null;
  event_type: string;
  minute: number | null;
  description: string | null;
  created_by: string;
  created_at: string;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
}): MatchEvent {
  return {
    id: row.id,
    matchId: row.match_id,
    teamId: row.team_id,
    playerId: row.player_id,
    eventType: row.event_type as any,
    minute: row.minute,
    description: row.description,
    createdBy: row.created_by,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidedBy: row.voided_by,
    voidReason: row.void_reason,
  };
}

export async function listMatchEvents(matchId: string, teamId?: string): Promise<MatchEvent[]> {
  const pool = getPool();
  let query = `
    SELECT id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at, voided_at, voided_by, void_reason
    FROM match_events
    WHERE match_id = $1 AND voided_at IS NULL
  `;
  const params: unknown[] = [matchId];

  if (teamId) {
    query += ` AND team_id = $2`;
    params.push(teamId);
  }

  query += ` ORDER BY minute ASC, created_at ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapMatchEvent);
}

export async function findMatchEventById(id: string): Promise<MatchEvent | null> {
  const result = await getPool().query(
    `SELECT id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at, voided_at, voided_by, void_reason
     FROM match_events
     WHERE id = $1`,
    [id],
  );
  return result.rowCount === 0 ? null : mapMatchEvent(result.rows[0]);
}

export async function createMatchEvent(input: MatchEventCreateInput, createdBy: string): Promise<MatchEvent> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const match = await client.query(`SELECT home_team_id, away_team_id, tournament_id, status FROM matches WHERE id = $1 FOR UPDATE`, [input.matchId]);
    if (!match.rowCount) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
    if (match.rows[0].status !== "IN_PROGRESS") throw new AppError(409, "Match events can only be recorded while the match is in progress", "MATCH_NOT_IN_PROGRESS");
    const clock = await client.query<{ is_running: boolean }>("SELECT is_running FROM match_clock_states WHERE match_id = $1 FOR UPDATE", [input.matchId]);
    if (!clock.rowCount || !clock.rows[0].is_running) {
      throw new AppError(409, "Chỉ được ghi diễn biến khi đồng hồ trận đang chạy.", "MATCH_CLOCK_NOT_RUNNING");
    }
    if ((input.eventType === "YELLOW_CARD" || input.eventType === "RED_CARD") && !input.playerId) {
      throw new AppError(400, "A player must be selected for a card event", "CARD_PLAYER_REQUIRED");
    }
    const approved = await client.query(`SELECT 1 FROM match_reports WHERE match_id = $1 AND status = 'APPROVED'`, [input.matchId]);
    if (approved.rowCount) throw new AppError(409, "The approved match report is locked", "MATCH_REPORT_LOCKED");
    if (![match.rows[0].home_team_id, match.rows[0].away_team_id].includes(input.teamId)) throw new AppError(400, "Event team is not part of this match", "INVALID_EVENT_TEAM");
    if (input.playerId) {
      const player = await client.query(`SELECT 1 FROM lineups WHERE match_id = $1 AND team_id = $2 AND player_id = $3`, [input.matchId, input.teamId, input.playerId]);
      if (!player.rowCount) throw new AppError(400, "Player must belong to this team's match lineup", "PLAYER_NOT_IN_LINEUP");
    }
    const result = await client.query(
      `INSERT INTO match_events (match_id, team_id, player_id, event_type, minute, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at, voided_at, voided_by, void_reason`,
      [
      input.matchId,
      input.teamId,
      input.playerId ?? null,
      input.eventType,
      input.minute ?? null,
      input.description ?? null,
      createdBy,
      ],
    );
    const event = mapMatchEvent(result.rows[0]);
    await client.query(`INSERT INTO match_event_history (event_id, match_id, action, event_snapshot, actor_id) VALUES ($1, $2, 'CREATED', $3::jsonb, $4)`, [event.id, event.matchId, JSON.stringify(event), createdBy]);
    if (event.eventType === "YELLOW_CARD" || event.eventType === "RED_CARD") {
      await client.query(
        `INSERT INTO match_event_discipline_outbox (event_id, action, payload)
         VALUES ($1, 'ISSUE_CARD', $2::jsonb) ON CONFLICT (event_id, action) DO NOTHING`,
        [event.id, JSON.stringify({
          eventId: event.id,
          playerId: event.playerId,
          matchId: event.matchId,
          tournamentId: match.rows[0].tournament_id,
          teamId: event.teamId,
          cardType: event.eventType === "YELLOW_CARD" ? "YELLOW" : "RED",
          minute: event.minute,
          reason: event.description,
          issuedBy: createdBy,
        })],
      );
    }
    await publishMatchUpdate(client, input.matchId, "match.event.created");
    await client.query("COMMIT");
    return event;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function deleteMatchEvent(id: string, actorId: string, reason: string): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT e.*, m.status AS match_status, m.tournament_id FROM match_events e JOIN matches m ON m.id = e.match_id WHERE e.id = $1 FOR UPDATE OF e, m`, [id]);
    if (!found.rowCount) { await client.query("ROLLBACK"); return false; }
    const row = found.rows[0];
    if (row.match_status !== "IN_PROGRESS") throw new AppError(409, "Events can only be corrected while the match is in progress", "MATCH_EVENT_LOCKED");
    const approved = await client.query(`SELECT 1 FROM match_reports WHERE match_id = $1 AND status = 'APPROVED'`, [row.match_id]);
    if (approved.rowCount) throw new AppError(409, "The approved match report is locked", "MATCH_REPORT_LOCKED");
    if (row.voided_at) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE match_events SET voided_at = NOW(), voided_by = $2, void_reason = $3 WHERE id = $1`, [id, actorId, reason]);
    await client.query(`INSERT INTO match_event_history (event_id, match_id, action, event_snapshot, actor_id, reason) VALUES ($1, $2, 'VOIDED', $3::jsonb, $4, $5)`, [id, row.match_id, JSON.stringify(row), actorId, reason]);
    if ((row.event_type === "YELLOW_CARD" || row.event_type === "RED_CARD") && row.player_id) {
      await client.query(
        `INSERT INTO match_event_discipline_outbox (event_id, action, payload)
         VALUES ($1, 'VOID_CARD', $2::jsonb) ON CONFLICT (event_id, action) DO NOTHING`,
        [id, JSON.stringify({ eventId: id, actorId, reason })],
      );
    }
    await publishMatchUpdate(client, row.match_id, "match.event.voided");
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

// Match Reports
function mapMatchReport(row: {
  id: string;
  match_id: string;
  referee_id: string;
  home_captain_id: string | null;
  away_captain_id: string | null;
  home_score_at_half_time: number | null;
  away_score_at_half_time: number | null;
  attendance: number | null;
  weather: string | null;
  notes: string | null;
  submitted_by: string;
  submitted_at: string;
  verified_by: string | null;
  verified_at: string | null;
  status: string;
  review_note: string | null;
  submission_snapshots: MatchReportSubmissionSnapshot[] | null;
}): MatchReport {
  return {
    id: row.id,
    matchId: row.match_id,
    refereeId: row.referee_id,
    homeCaptainId: row.home_captain_id,
    awayCaptainId: row.away_captain_id,
    homeScoreAtHalfTime: row.home_score_at_half_time,
    awayScoreAtHalfTime: row.away_score_at_half_time,
    attendance: row.attendance,
    weather: row.weather,
    notes: row.notes,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    status: row.status as any,
    reviewNote: row.review_note,
    submissionSnapshots: row.submission_snapshots ?? [],
  };
}

export async function findMatchReportByMatchId(matchId: string): Promise<MatchReport | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time, away_score_at_half_time,
            attendance, weather, notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note, submission_snapshots
     FROM match_reports
     WHERE match_id = $1`,
    [matchId],
  );

  if (result.rowCount === 0) return null;
  return mapMatchReport(result.rows[0]);
}

export async function findMatchReportById(id: string): Promise<MatchReport | null> {
  const result = await getPool().query(
    `SELECT id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time, away_score_at_half_time,
            attendance, weather, notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note, submission_snapshots
     FROM match_reports
     WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) return null;
  return mapMatchReport(result.rows[0]);
}

export async function createMatchReport(input: MatchReportCreateInput, submittedBy: string): Promise<MatchReport> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO match_reports (match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time, away_score_at_half_time,
                              attendance, weather, notes, submitted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time, away_score_at_half_time,
              attendance, weather, notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note, submission_snapshots`,
    [
      input.matchId,
      input.refereeId,
      input.homeCaptainId ?? null,
      input.awayCaptainId ?? null,
      input.homeScoreAtHalfTime ?? null,
      input.awayScoreAtHalfTime ?? null,
      input.attendance ?? null,
      input.weather ?? null,
      input.notes ?? null,
      submittedBy,
    ],
  );

  return mapMatchReport(result.rows[0]);
}

export async function resubmitMatchReport(input: MatchReportCreateInput, submittedBy: string): Promise<MatchReport | null> {
  const result = await getPool().query(
    `UPDATE match_reports
     SET referee_id = $2, home_captain_id = $3, away_captain_id = $4,
         home_score_at_half_time = $5, away_score_at_half_time = $6,
         attendance = $7, weather = $8, notes = $9, submitted_by = $10,
         submitted_at = NOW(), verified_by = NULL, verified_at = NULL,
         status = 'PENDING', review_note = NULL
     WHERE match_id = $1 AND status = 'REVISION_REQUIRED'
     RETURNING id, match_id, referee_id, home_captain_id, away_captain_id,
               home_score_at_half_time, away_score_at_half_time, attendance, weather,
               notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note, submission_snapshots`,
    [
      input.matchId, input.refereeId, input.homeCaptainId ?? null, input.awayCaptainId ?? null,
      input.homeScoreAtHalfTime ?? null, input.awayScoreAtHalfTime ?? null, input.attendance ?? null,
      input.weather ?? null, input.notes ?? null, submittedBy,
    ],
  );
  return result.rowCount ? mapMatchReport(result.rows[0]) : null;
}

/** Referees submit a pending report. The result remains unofficial until BTC review. */
export async function finalizeMatchReport(input: MatchReportCreateInput, submittedBy: string): Promise<MatchReport> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const matchResult = await client.query<{ tournament_id: string; status: string; home_team_id: string | null; away_team_id: string | null }>(
      "SELECT tournament_id, status, home_team_id, away_team_id FROM matches WHERE id = $1 FOR UPDATE",
      [input.matchId],
    );
    const match = matchResult.rows[0];
    if (!match) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
    if (match.status !== "FINISHED") {
      throw new AppError(409, "Match must be finished before the referee can submit its report", "MATCH_NOT_FINISHED");
    }
    const result = await client.query<{ status: string }>(
      "SELECT status FROM match_results WHERE match_id = $1 FOR UPDATE",
      [input.matchId],
    );
    if (!result.rowCount || result.rows[0].status !== "PENDING") {
      throw new AppError(409, "A pending result is required before the report can be submitted", "MATCH_RESULT_REQUIRED");
    }
    const [lineups, events, score, clock] = await Promise.all([
      client.query(`SELECT team_id, player_id, position, jersey_number, is_starting, confirmed_by, confirmed_at
                    FROM lineups WHERE match_id = $1 ORDER BY team_id, is_starting DESC, jersey_number NULLS LAST, player_id`, [input.matchId]),
      client.query(`SELECT team_id, player_id, event_type, minute, description, created_by, created_at
                    FROM match_events WHERE match_id = $1 AND voided_at IS NULL ORDER BY minute NULLS LAST, created_at`, [input.matchId]),
      client.query(`SELECT home_score, away_score, home_extra_time_score, away_extra_time_score,
                           home_penalty_score, away_penalty_score
                    FROM match_results WHERE match_id = $1`, [input.matchId]),
      client.query(`SELECT phase, elapsed_seconds, total_elapsed_seconds, updated_at
                    FROM match_clock_states WHERE match_id = $1`, [input.matchId]),
    ]);
    const submittedAt = new Date().toISOString();
    const submissionSnapshot: MatchReportSubmissionSnapshot = {
      submittedAt,
      result: score.rows[0] ? {
        homeScore: score.rows[0].home_score,
        awayScore: score.rows[0].away_score,
        homeExtraTimeScore: score.rows[0].home_extra_time_score,
        awayExtraTimeScore: score.rows[0].away_extra_time_score,
        homePenaltyScore: score.rows[0].home_penalty_score,
        awayPenaltyScore: score.rows[0].away_penalty_score,
      } : null,
      lineups: lineups.rows.map((row) => ({
        teamId: row.team_id, playerId: row.player_id, position: row.position,
        jerseyNumber: row.jersey_number, isStarting: row.is_starting,
        confirmedBy: row.confirmed_by,
        confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).toISOString() : null,
      })),
      events: events.rows.map((row) => ({
        teamId: row.team_id, playerId: row.player_id, eventType: row.event_type as MatchEvent["eventType"],
        minute: row.minute, description: row.description, createdBy: row.created_by,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      clock: clock.rows[0] ? {
        phase: clock.rows[0].phase,
        elapsedSeconds: clock.rows[0].elapsed_seconds,
        totalElapsedSeconds: clock.rows[0].total_elapsed_seconds,
        updatedAt: new Date(clock.rows[0].updated_at).toISOString(),
      } : null,
    };
    const prior = await client.query<{ id: string; status: string }>(
      "SELECT id, status FROM match_reports WHERE match_id = $1 FOR UPDATE",
      [input.matchId],
    );
    let saved;
    if (prior.rowCount) {
      if (prior.rows[0].status !== "REVISION_REQUIRED") {
        throw new AppError(409, "The match report has already been submitted", "REPORT_EXISTS");
      }
      saved = await client.query(
        `UPDATE match_reports
         SET referee_id = $2, home_captain_id = $3, away_captain_id = $4,
             home_score_at_half_time = $5, away_score_at_half_time = $6,
             attendance = $7, weather = $8, notes = $9, submitted_by = $10,
             submitted_at = NOW(), verified_by = NULL, verified_at = NULL,
             submission_snapshots = submission_snapshots || jsonb_build_array($11::jsonb),
             status = 'PENDING', review_note = NULL
         WHERE id = $1
         RETURNING id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time,
                   away_score_at_half_time, attendance, weather, notes, submitted_by, submitted_at,
                   verified_by, verified_at, status, review_note, submission_snapshots`,
        [prior.rows[0].id, input.refereeId, input.homeCaptainId ?? null, input.awayCaptainId ?? null,
          input.homeScoreAtHalfTime ?? null, input.awayScoreAtHalfTime ?? null, input.attendance ?? null,
          input.weather ?? null, input.notes ?? null, submittedBy, JSON.stringify(submissionSnapshot)],
      );
    } else {
      saved = await client.query(
        `INSERT INTO match_reports (match_id, referee_id, home_captain_id, away_captain_id,
             home_score_at_half_time, away_score_at_half_time, attendance, weather, notes,
             submitted_by, status, submission_snapshots)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', jsonb_build_array($11::jsonb))
         RETURNING id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time,
                   away_score_at_half_time, attendance, weather, notes, submitted_by, submitted_at,
                   verified_by, verified_at, status, review_note, submission_snapshots`,
        [input.matchId, input.refereeId, input.homeCaptainId ?? null, input.awayCaptainId ?? null,
          input.homeScoreAtHalfTime ?? null, input.awayScoreAtHalfTime ?? null, input.attendance ?? null,
          input.weather ?? null, input.notes ?? null, submittedBy, JSON.stringify(submissionSnapshot)],
      );
    }
    const report = saved.rows[0];
    await client.query("COMMIT");
    return mapMatchReport(report);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateMatchReport(id: string, input: MatchReportUpdateInput): Promise<MatchReport | null> {
  const pool = getPool();
  if (!input.status || !input.verifiedBy) return null;
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ match_id: string; status: string }>(
      "SELECT match_id, status FROM match_reports WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    if (found.rows[0].status !== "PENDING") {
      throw new AppError(409, "Only pending match reports can be reviewed", "REPORT_ALREADY_REVIEWED");
    }
    const matchResult = await client.query<{ tournament_id: string; status: string }>(
      "SELECT tournament_id, status FROM matches WHERE id = $1 FOR UPDATE",
      [found.rows[0].match_id],
    );
    if (!matchResult.rowCount) throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
    if (input.status === "APPROVED") {
      if (matchResult.rows[0].status !== "FINISHED") {
        throw new AppError(409, "Match must be finished before its report can be approved", "MATCH_NOT_FINISHED");
      }
      const result = await client.query<{ id: string; status: string }>(
        "SELECT id, status FROM match_results WHERE match_id = $1 FOR UPDATE",
        [found.rows[0].match_id],
      );
      if (!result.rowCount) throw new AppError(409, "The referee must submit a result before report approval", "MATCH_RESULT_REQUIRED");
      if (result.rows[0].status !== "PENDING") {
        throw new AppError(409, "Only a pending result can be approved with this report", "MATCH_RESULT_NOT_PENDING");
      }
      const knockout = await client.query<{
        home_team_id: string; away_team_id: string; home_score: number; away_score: number;
        home_extra_time_score: number | null; away_extra_time_score: number | null;
        home_penalty_score: number | null; away_penalty_score: number | null;
      }>(
        `SELECT m.home_team_id, m.away_team_id, r.home_score, r.away_score,
                r.home_extra_time_score, r.away_extra_time_score, r.home_penalty_score, r.away_penalty_score
         FROM matches m JOIN match_results r ON r.match_id = m.id
         JOIN match_bracket_slots b ON b.match_id = m.id WHERE m.id = $1 FOR UPDATE OF b`,
        [found.rows[0].match_id],
      );
      if (knockout.rowCount) {
        const row = knockout.rows[0];
        const homeTotal = row.home_score + (row.home_extra_time_score ?? 0);
        const awayTotal = row.away_score + (row.away_extra_time_score ?? 0);
        if (homeTotal === awayTotal && (row.home_penalty_score === null || row.away_penalty_score === null || row.home_penalty_score === row.away_penalty_score)) {
          throw new AppError(409, "Trận loại trực tiếp đang hòa; cần nhập kết quả luân lưu hợp lệ trước khi duyệt", "KNOCKOUT_WINNER_REQUIRED");
        }
      }
    }
    const updated = await client.query(
      `UPDATE match_reports
       SET status = $2, verified_by = $3, verified_at = NOW(), review_note = $4
       WHERE id = $1
       RETURNING id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time,
                 away_score_at_half_time, attendance, weather, notes, submitted_by, submitted_at,
                 verified_by, verified_at, status, review_note, submission_snapshots`,
      [id, input.status, input.verifiedBy, input.reviewNote ?? null],
    );
    await client.query(
      `INSERT INTO match_report_reviews (report_id, status, review_note, reviewed_by)
       VALUES ($1, $2, $3, $4)`,
      [id, input.status, input.reviewNote ?? null, input.verifiedBy],
    );
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [matchResult.rows[0].tournament_id]);
    if (input.status === "APPROVED") {
      await client.query("UPDATE match_results SET status = 'APPROVED' WHERE match_id = $1", [found.rows[0].match_id]);
      await client.query("UPDATE matches SET status = 'VERIFIED', updated_at = NOW() WHERE id = $1", [found.rows[0].match_id]);
      const result = await client.query<{
        home_team_id: string; away_team_id: string; home_score: number; away_score: number;
        home_extra_time_score: number | null; away_extra_time_score: number | null;
        home_penalty_score: number | null; away_penalty_score: number | null;
      }>(
        `SELECT m.home_team_id, m.away_team_id, r.home_score, r.away_score,
                r.home_extra_time_score, r.away_extra_time_score, r.home_penalty_score, r.away_penalty_score
         FROM matches m JOIN match_results r ON r.match_id = m.id JOIN match_bracket_slots b ON b.match_id = m.id
         WHERE m.id = $1`, [found.rows[0].match_id],
      );
      if (result.rowCount) {
        const row = result.rows[0];
        const homeTotal = row.home_score + (row.home_extra_time_score ?? 0);
        const awayTotal = row.away_score + (row.away_extra_time_score ?? 0);
        const homeWins = homeTotal === awayTotal
          ? (row.home_penalty_score ?? -1) > (row.away_penalty_score ?? -1)
          : homeTotal > awayTotal;
        await advanceApprovedKnockoutWinner(client, found.rows[0].match_id, homeWins ? row.home_team_id : row.away_team_id);
      }
    } else if (input.status === "REJECTED") {
      await client.query("UPDATE match_results SET status = 'REJECTED' WHERE match_id = $1", [found.rows[0].match_id]);
    } else {
      await client.query("UPDATE match_results SET status = 'PENDING' WHERE match_id = $1", [found.rows[0].match_id]);
    }
    await recalculateStandings(client, matchResult.rows[0].tournament_id);
    await publishMatchUpdate(client, found.rows[0].match_id, input.status === "APPROVED" ? "match.finalized" : "match.report.updated");
    await client.query("COMMIT");
    return mapMatchReport(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

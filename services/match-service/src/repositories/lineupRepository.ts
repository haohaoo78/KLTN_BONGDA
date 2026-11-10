import type {
  Lineup,
  LineupCreateInput,
  MatchEvent,
  MatchEventCreateInput,
  MatchReport,
  MatchReportCreateInput,
  MatchReportUpdateInput,
} from "../models/match";
import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import { recalculateStandings } from "./matchRepository";

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

export async function createLineup(input: LineupCreateInput): Promise<Lineup> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO lineups (match_id, team_id, player_id, position, jersey_number, is_starting)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, match_id, team_id, player_id, position, jersey_number, is_starting, confirmed_by, confirmed_at, created_at`,
    [
      input.matchId,
      input.teamId,
      input.playerId,
      input.position ?? null,
      input.jerseyNumber ?? null,
      input.isStarting ?? true,
    ],
  );

  return mapLineup(result.rows[0]);
}

export async function confirmLineup(matchId: string, teamId: string, confirmedBy: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE lineups SET confirmed_by = $1, confirmed_at = NOW()
     WHERE match_id = $2 AND team_id = $3`,
    [confirmedBy, matchId, teamId],
  );
}

export async function deleteLineup(matchId: string, teamId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    `DELETE FROM lineups WHERE match_id = $1 AND team_id = $2`,
    [matchId, teamId],
  );
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
  };
}

export async function listMatchEvents(matchId: string, teamId?: string): Promise<MatchEvent[]> {
  const pool = getPool();
  let query = `
    SELECT id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at
    FROM match_events
    WHERE match_id = $1
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
    `SELECT id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at
     FROM match_events
     WHERE id = $1`,
    [id],
  );
  return result.rowCount === 0 ? null : mapMatchEvent(result.rows[0]);
}

export async function createMatchEvent(input: MatchEventCreateInput, createdBy: string): Promise<MatchEvent> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO match_events (match_id, team_id, player_id, event_type, minute, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, match_id, team_id, player_id, event_type, minute, description, created_by, created_at`,
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

  return mapMatchEvent(result.rows[0]);
}

export async function deleteMatchEvent(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM match_events WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
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
  };
}

export async function findMatchReportByMatchId(matchId: string): Promise<MatchReport | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time, away_score_at_half_time,
            attendance, weather, notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note
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
            attendance, weather, notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note
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
              attendance, weather, notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note`,
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
               notes, submitted_by, submitted_at, verified_by, verified_at, status, review_note`,
    [
      input.matchId, input.refereeId, input.homeCaptainId ?? null, input.awayCaptainId ?? null,
      input.homeScoreAtHalfTime ?? null, input.awayScoreAtHalfTime ?? null, input.attendance ?? null,
      input.weather ?? null, input.notes ?? null, submittedBy,
    ],
  );
  return result.rowCount ? mapMatchReport(result.rows[0]) : null;
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
      const result = await client.query<{ id: string }>(
        "SELECT id FROM match_results WHERE match_id = $1 FOR UPDATE",
        [found.rows[0].match_id],
      );
      if (!result.rowCount) throw new AppError(409, "The referee must submit a result before report approval", "MATCH_RESULT_REQUIRED");
    }
    const updated = await client.query(
      `UPDATE match_reports
       SET status = $2, verified_by = $3, verified_at = NOW(), review_note = $4
       WHERE id = $1
       RETURNING id, match_id, referee_id, home_captain_id, away_captain_id, home_score_at_half_time,
                 away_score_at_half_time, attendance, weather, notes, submitted_by, submitted_at,
                 verified_by, verified_at, status, review_note`,
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
    } else if (input.status === "REJECTED") {
      await client.query("UPDATE match_results SET status = 'REJECTED' WHERE match_id = $1", [found.rows[0].match_id]);
    } else {
      await client.query("UPDATE match_results SET status = 'PENDING' WHERE match_id = $1", [found.rows[0].match_id]);
    }
    await recalculateStandings(client, matchResult.rows[0].tournament_id);
    await client.query("COMMIT");
    return mapMatchReport(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

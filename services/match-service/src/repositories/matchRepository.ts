import type {
  Match,
  MatchCreateInput,
  MatchUpdateInput,
  MatchResult,
  MatchResultCreateInput,
  Standing,
  StandingUpdateInput,
  GeneratedFixtureInput,
  FixtureGenerationResult,
} from "../models/match";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import type { PoolClient } from "pg";

export async function recalculateStandings(client: PoolClient, tournamentId: string): Promise<void> {
  await client.query("DELETE FROM standings WHERE tournament_id = $1", [tournamentId]);
  await client.query(
    `WITH match_scores AS (
         SELECT tournament_id, home_team_id, away_team_id, result.home_score, result.away_score
       FROM matches
       JOIN match_results AS result ON result.match_id = matches.id
         WHERE tournament_id = $1 AND matches.status IN ('FINISHED', 'VERIFIED', 'LOCKED')
           AND result.status = 'APPROVED'
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
  home_team_id: string;
  away_team_id: string;
  match_date: string | null;
  venue: string | null;
  round: string | null;
  status: string;
  created_at: string;
  updated_at: string;
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

  let countQuery = "SELECT COUNT(*)::text AS count FROM matches WHERE tournament_id = $1";
  let listQuery = `
    SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round, status, created_at, updated_at
    FROM matches
    WHERE tournament_id = $1
  `;
  const params: unknown[] = [tournamentId];
  let paramIndex = 2;

  if (status) {
    countQuery += ` AND status = $2`;
    listQuery += ` AND status = $2`;
    params.push(status);
    paramIndex++;
  }

  listQuery += ` ORDER BY match_date ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
  params.push(limit, offset);

  const countResult = await pool.query<{ count: string }>(countQuery, status ? [tournamentId, status] : [tournamentId]);
  const total = Number(countResult.rows[0]?.count ?? 0);

  const result = await pool.query(listQuery, params);

  return {
    items: result.rows.map(mapMatch),
    total,
  };
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
): Promise<FixtureGenerationResult> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [tournamentId]);
    const existingRun = await client.query<{ legs: number }>(
      "SELECT legs FROM match_fixture_generations WHERE draw_version_id = $1 FOR UPDATE",
      [drawVersionId],
    );
    if (existingRun.rowCount) {
      if (existingRun.rows[0].legs !== legs) {
        throw new AppError(409, "Fixtures đã được tạo với số lượt khác", "FIXTURES_ALREADY_GENERATED");
      }
      const existingMatches = await client.query(
        `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round,
                status, created_at, updated_at
         FROM matches WHERE draw_version_id = $1 ORDER BY round, fixture_key`,
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
      `INSERT INTO match_fixture_generations (tournament_id, draw_version_id, legs, generated_by)
       VALUES ($1, $2, $3, $4)`,
      [tournamentId, drawVersionId, legs, generatedBy],
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
           (tournament_id, home_team_id, away_team_id, match_date, round, status, draw_version_id, fixture_key)
         VALUES ($1, $2, $3, NULL, $4, 'UNSCHEDULED', $5, $6)`,
        [
          tournamentId,
          fixture.homeTeamId,
          fixture.awayTeamId,
          fixture.round,
          drawVersionId,
          fixtureKey,
        ],
      );
    }
    const generated = await client.query(
      `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round,
              status, created_at, updated_at
       FROM matches WHERE draw_version_id = $1 ORDER BY round, fixture_key`,
      [drawVersionId],
    );
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

export async function updateMatch(id: string, input: MatchUpdateInput): Promise<Match | null> {
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
    const current = await client.query<{ tournament_id: string }>(
      "SELECT tournament_id FROM matches WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const tournamentId = current.rows[0].tournament_id;
    await lockTournamentStandings(client, tournamentId);
    await client.query(`UPDATE matches SET ${sets.join(", ")} WHERE id = $${idx}`, values);
    await recalculateStandings(client, tournamentId);
    const updated = await client.query(
      `SELECT id, tournament_id, home_team_id, away_team_id, match_date, venue, round, status, created_at, updated_at
       FROM matches WHERE id = $1`,
      [id],
    );
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

    if (match.status === "VERIFIED") {
      await client.query("UPDATE matches SET status = 'FINISHED', updated_at = NOW() WHERE id = $1", [input.matchId]);
    }
    await recalculateStandings(client, match.tournament_id);
    await client.query("COMMIT");
    return mapMatchResult(saved.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

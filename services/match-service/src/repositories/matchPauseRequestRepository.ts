import type { PoolClient } from "pg";
import type { MatchPauseRequest, MatchPauseRequestStatus } from "../models/matchPauseRequest";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";

type PauseRequestRow = {
  id: string;
  match_id: string;
  requested_by: string;
  reason: string;
  status: MatchPauseRequestStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

function mapPauseRequest(row: PauseRequestRow): MatchPauseRequest {
  return {
    id: row.id,
    matchId: row.match_id,
    requestedBy: row.requested_by,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

const columns = `id, match_id, requested_by, reason, status, reviewed_by, reviewed_at, review_note, created_at`;

export async function createMatchPauseRequest(
  matchId: string,
  requestedBy: string,
  reason: string,
): Promise<MatchPauseRequest> {
  const pool = getPool();
  try {
    const result = await pool.query<PauseRequestRow>(
      `INSERT INTO match_pause_requests (match_id, requested_by, reason)
       VALUES ($1, $2, $3)
       RETURNING ${columns}`,
      [matchId, requestedBy, reason],
    );
    return mapPauseRequest(result.rows[0]);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AppError(409, "A pending pause request already exists for this match", "PAUSE_REQUEST_PENDING");
    }
    throw error;
  }
}

export async function listMatchPauseRequests(matchId: string): Promise<MatchPauseRequest[]> {
  const result = await getPool().query<PauseRequestRow>(
    `SELECT ${columns} FROM match_pause_requests
     WHERE match_id = $1 ORDER BY created_at DESC`,
    [matchId],
  );
  return result.rows.map(mapPauseRequest);
}

export async function findMatchPauseRequest(id: string): Promise<MatchPauseRequest | null> {
  const result = await getPool().query<PauseRequestRow>(
    `SELECT ${columns} FROM match_pause_requests WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapPauseRequest(result.rows[0]) : null;
}

export async function reviewMatchPauseRequest(
  id: string,
  decision: Exclude<MatchPauseRequestStatus, "PENDING">,
  reviewerId: string,
  reviewNote: string | null,
): Promise<MatchPauseRequest> {
  const pool = getPool();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    const requestResult = await client.query<PauseRequestRow>(
      `SELECT ${columns} FROM match_pause_requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const request = requestResult.rows[0];
    if (!request) {
      throw new AppError(404, "Pause request not found", "PAUSE_REQUEST_NOT_FOUND");
    }
    if (request.status !== "PENDING") {
      throw new AppError(409, "Pause request has already been reviewed", "PAUSE_REQUEST_ALREADY_REVIEWED");
    }
    if (decision === "APPROVED") {
      const matchResult = await client.query<{ status: string }>(
        "SELECT status FROM matches WHERE id = $1 FOR UPDATE",
        [request.match_id],
      );
      const status = matchResult.rows[0]?.status;
      if (!status || !["SCHEDULED", "LINEUP_CONFIRMED", "IN_PROGRESS"].includes(status)) {
        throw new AppError(409, "Only a scheduled or active match can be paused", "MATCH_NOT_PAUSABLE");
      }
      await client.query(
        "UPDATE matches SET status = 'POSTPONED', updated_at = NOW() WHERE id = $1",
        [request.match_id],
      );
    }
    const result = await client.query<PauseRequestRow>(
      `UPDATE match_pause_requests
       SET status = $2, reviewed_by = $3, reviewed_at = NOW(), review_note = $4
       WHERE id = $1
       RETURNING ${columns}`,
      [id, decision, reviewerId, reviewNote],
    );
    await client.query("COMMIT");
    return mapPauseRequest(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

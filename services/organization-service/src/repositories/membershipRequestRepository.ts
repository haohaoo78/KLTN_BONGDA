import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

export type PlayerLeaveRequest = {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  userId: string;
  playerName: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  overdue: boolean;
};

type LeaveRequestRow = {
  id: string;
  team_id: string;
  team_name: string;
  player_id: string;
  user_id: string;
  player_name: string | null;
  reason: string;
  status: PlayerLeaveRequest["status"];
  requested_at: Date | string;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  decision_reason: string | null;
};

const leaveSelect = `
  SELECT r.id, r.team_id, t.name AS team_name, r.player_id, r.user_id,
         COALESCE(p.full_name, 'Cầu thủ') AS player_name, r.reason, r.status,
         r.requested_at, r.reviewed_by, r.reviewed_at, r.decision_reason
  FROM player_leave_requests r
  JOIN teams t ON t.id = r.team_id
  JOIN players p ON p.id = r.player_id
`;

function mapLeaveRequest(row: LeaveRequestRow): PlayerLeaveRequest {
  const requestedAt = new Date(row.requested_at);
  return {
    id: row.id,
    teamId: row.team_id,
    teamName: row.team_name,
    playerId: row.player_id,
    userId: row.user_id,
    playerName: row.player_name ?? "Cầu thủ",
    reason: row.reason,
    status: row.status,
    requestedAt: requestedAt.toISOString(),
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    decisionReason: row.decision_reason,
    overdue: Date.now() - requestedAt.getTime() >= 3 * 24 * 60 * 60 * 1000,
  };
}

export async function createPlayerLeaveRequest(userId: string, reason: string): Promise<PlayerLeaveRequest> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const membership = await client.query<{ id: string; team_id: string }>(
      `SELECT id, team_id FROM players
       WHERE user_id = $1 AND left_at IS NULL
       FOR UPDATE`,
      [userId],
    );
    if (!membership.rowCount) {
      throw new AppError(409, "You are not an active member of a team", "TEAM_MEMBERSHIP_REQUIRED");
    }
    const created = await client.query<{ id: string }>(
      `INSERT INTO player_leave_requests (team_id, player_id, user_id, reason)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [membership.rows[0].team_id, membership.rows[0].id, userId, reason],
    );
    const request = await client.query<LeaveRequestRow>(
      `${leaveSelect} WHERE r.id = $1`,
      [created.rows[0].id],
    );
    await client.query("COMMIT");
    return mapLeaveRequest(request.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "A pending leave request already exists", "APPLICATION_PENDING");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listPlayerLeaveRequestsForUser(userId: string): Promise<PlayerLeaveRequest[]> {
  const result = await getPool().query<LeaveRequestRow>(
    `${leaveSelect} WHERE r.user_id = $1 ORDER BY r.requested_at DESC`,
    [userId],
  );
  return result.rows.map(mapLeaveRequest);
}

export async function listTeamPlayerLeaveRequests(
  teamId: string,
  overdueOnly = false,
): Promise<PlayerLeaveRequest[]> {
  const result = await getPool().query<LeaveRequestRow>(
    `${leaveSelect}
     WHERE r.team_id = $1
       ${overdueOnly ? "AND r.status = 'PENDING' AND r.requested_at <= NOW() - INTERVAL '3 days'" : ""}
     ORDER BY r.requested_at ASC`,
    [teamId],
  );
  return result.rows.map(mapLeaveRequest);
}

export async function findPlayerLeaveRequest(id: string): Promise<PlayerLeaveRequest | null> {
  const result = await getPool().query<LeaveRequestRow>(
    `${leaveSelect} WHERE r.id = $1`,
    [id],
  );
  return result.rowCount ? mapLeaveRequest(result.rows[0]) : null;
}

export async function getActiveTournamentIdsForLeaveRequest(requestId: string): Promise<string[]> {
  const result = await getPool().query<{ tournament_id: string }>(
    `SELECT DISTINCT tr.tournament_id
     FROM player_leave_requests lr
     JOIN rosters r ON r.player_id = lr.player_id AND r.team_id = lr.team_id
     JOIN team_registrations tr
       ON tr.team_id = r.team_id AND tr.tournament_id = r.tournament_id
     WHERE lr.id = $1 AND lr.status = 'PENDING'
       AND tr.status IN ('PENDING', 'APPROVED')`,
    [requestId],
  );
  return result.rows.map((row) => row.tournament_id);
}

export async function reviewPlayerLeaveRequest(input: {
  requestId: string;
  reviewerId: string;
  decision: "APPROVED" | "REJECTED";
  decisionReason: string | null;
}): Promise<PlayerLeaveRequest> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      player_id: string;
      user_id: string;
      status: string;
    }>(
      `SELECT player_id, user_id, status FROM player_leave_requests
       WHERE id = $1 FOR UPDATE`,
      [input.requestId],
    );
    if (!current.rowCount) {
      throw new AppError(404, "Leave request not found", "REQUEST_NOT_FOUND");
    }
    if (current.rows[0].user_id === input.reviewerId) {
      throw new AppError(403, "You cannot review your own leave request", "SELF_REVIEW_FORBIDDEN");
    }
    if (current.rows[0].status !== "PENDING") {
      throw new AppError(409, "Leave request has already been processed", "REQUEST_ALREADY_REVIEWED");
    }
    const membership = await client.query<{ id: string }>(
      `SELECT id FROM players
       WHERE id = $1 AND user_id = $2 AND left_at IS NULL
       FOR UPDATE`,
      [current.rows[0].player_id, current.rows[0].user_id],
    );
    if (!membership.rowCount) {
      throw new AppError(409, "The player is no longer an active member of this team", "MEMBERSHIP_CHANGED");
    }
    if (input.decision === "APPROVED") {
      await client.query(
        "UPDATE players SET left_at = NOW() WHERE id = $1 AND left_at IS NULL",
        [current.rows[0].player_id],
      );
    }
    const updated = await client.query(
      `UPDATE player_leave_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), decision_reason = $3
       WHERE id = $4
       RETURNING id`,
      [input.decision, input.reviewerId, input.decisionReason, input.requestId],
    );
    const request = await client.query<LeaveRequestRow>(
      `${leaveSelect} WHERE r.id = $1`,
      [updated.rows[0].id],
    );
    await client.query("COMMIT");
    return mapLeaveRequest(request.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function withdrawPlayerLeaveRequest(
  requestId: string,
  userId: string,
): Promise<PlayerLeaveRequest> {
  const result = await getPool().query(
    `UPDATE player_leave_requests
     SET status = 'WITHDRAWN'
     WHERE id = $1 AND user_id = $2 AND status = 'PENDING'
     RETURNING id`,
    [requestId, userId],
  );
  if (!result.rowCount) {
    throw new AppError(409, "Only your pending leave request can be withdrawn", "REQUEST_NOT_WITHDRAWABLE");
  }
  const request = await findPlayerLeaveRequest(requestId);
  if (!request) {
    throw new AppError(404, "Leave request not found", "REQUEST_NOT_FOUND");
  }
  return request;
}

export async function listOverdueLeaveRequestsForReminders(): Promise<PlayerLeaveRequest[]> {
  const result = await getPool().query<LeaveRequestRow>(
    `${leaveSelect}
     WHERE r.status = 'PENDING' AND r.requested_at <= NOW() - INTERVAL '3 days'
       AND (r.last_reminded_at IS NULL OR r.last_reminded_at <= NOW() - INTERVAL '3 days')
     ORDER BY r.requested_at ASC LIMIT 100`,
  );
  return result.rows.map(mapLeaveRequest);
}

export async function markLeaveRequestReminderSent(requestId: string): Promise<void> {
  await getPool().query(
    `UPDATE player_leave_requests
     SET last_reminded_at = NOW()
     WHERE id = $1 AND status = 'PENDING'`,
    [requestId],
  );
}

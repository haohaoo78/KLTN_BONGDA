import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

export type WithdrawalRequest = {
  id: string;
  registrationId: string;
  teamId: string;
  tournamentId: string;
  requestedBy: string;
  reason: string;
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED" | "CANCELLED";
  desiredDecision: "APPROVED" | "REJECTED" | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

function mapRow(row: any): WithdrawalRequest {
  return {
    id: row.id,
    registrationId: row.registration_id,
    teamId: row.team_id,
    tournamentId: row.tournament_id,
    requestedBy: row.requested_by,
    reason: row.reason,
    status: row.status,
    desiredDecision: row.desired_decision ?? null,
    decisionNote: row.decision_note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export async function createWithdrawalRequest(input: {
  registrationId: string; teamId: string; tournamentId: string; requestedBy: string; reason: string;
}): Promise<WithdrawalRequest> {
  const pool = getPool();
  try {
    const result = await pool.query(
      `INSERT INTO team_registration_withdrawal_requests
         (registration_id, team_id, tournament_id, requested_by, reason)
       SELECT $1,$2,$3,$4,$5
       WHERE EXISTS (SELECT 1 FROM team_registrations WHERE id=$1 AND team_id=$2 AND tournament_id=$3 AND status='APPROVED')
       RETURNING *`,
      [input.registrationId, input.teamId, input.tournamentId, input.requestedBy, input.reason.trim()],
    );
    if (!result.rowCount) throw new AppError(409, "Chỉ đội đã được duyệt mới có thể yêu cầu rút", "REGISTRATION_NOT_APPROVED");
    return mapRow(result.rows[0]);
  } catch (error: any) {
    if (error?.code === "23505") throw new AppError(409, "Đội đã có yêu cầu rút đang chờ BTC xử lý", "WITHDRAWAL_REQUEST_PENDING");
    throw error;
  }
}

export async function listWithdrawalRequests(tournamentId: string): Promise<WithdrawalRequest[]> {
  const result = await getPool().query(
    `SELECT * FROM team_registration_withdrawal_requests WHERE tournament_id=$1 ORDER BY created_at DESC`,
    [tournamentId],
  );
  return result.rows.map(mapRow);
}

export async function listWithdrawalRequestsByRegistration(registrationId: string): Promise<WithdrawalRequest[]> {
  const result = await getPool().query(
    `SELECT * FROM team_registration_withdrawal_requests WHERE registration_id=$1 ORDER BY created_at DESC`,
    [registrationId],
  );
  return result.rows.map(mapRow);
}

export async function findWithdrawalRequest(id: string): Promise<WithdrawalRequest | null> {
  const result = await getPool().query(`SELECT * FROM team_registration_withdrawal_requests WHERE id=$1`, [id]);
  return result.rowCount ? mapRow(result.rows[0]) : null;
}

export const getWithdrawalRequestById = findWithdrawalRequest;

export async function cancelWithdrawalRequest(id: string, captainId: string): Promise<WithdrawalRequest> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE team_registration_withdrawal_requests
       SET status='CANCELLED', decided_by=$2, decided_at=NOW(), decision_note='Đội trưởng đã hủy yêu cầu trước khi BTC quyết định.', updated_at=NOW()
       WHERE id=$1 AND requested_by=$2 AND status='PENDING' RETURNING *`,
      [id, captainId],
    );
    if (!result.rowCount) {
      const existing = await client.query(`SELECT requested_by,status FROM team_registration_withdrawal_requests WHERE id=$1`, [id]);
      if (!existing.rowCount) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
      if (existing.rows[0].requested_by !== captainId) throw new AppError(403, "You cannot cancel this withdrawal request", "FORBIDDEN");
      throw new AppError(409, "Chỉ có thể hủy yêu cầu khi BTC chưa bắt đầu xử lý", "WITHDRAWAL_REQUEST_NOT_CANCELLABLE");
    }
    await client.query("COMMIT");
    return mapRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function beginWithdrawalDecision(input: {
  id: string; decision: "APPROVED" | "REJECTED"; decidedBy: string; note: string;
}): Promise<WithdrawalRequest> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(`SELECT * FROM team_registration_withdrawal_requests WHERE id=$1 FOR UPDATE`, [input.id]);
    if (!locked.rowCount) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
    const row = locked.rows[0];
    if (row.status === "PENDING") {
      const updated = await client.query(
        `UPDATE team_registration_withdrawal_requests
         SET status='PROCESSING',desired_decision=$2,decided_by=$3,decision_note=NULLIF(BTRIM($4), ''),updated_at=NOW()
         WHERE id=$1 RETURNING *`,
        [input.id, input.decision, input.decidedBy, input.note],
      );
      await client.query("COMMIT");
      return mapRow(updated.rows[0]);
    }
    if (row.status !== "PROCESSING" || row.desired_decision !== input.decision) {
      throw new AppError(409, "Yêu cầu rút đã được xử lý hoặc đang xử lý quyết định khác", "WITHDRAWAL_REQUEST_ALREADY_DECIDED");
    }
    await client.query("COMMIT");
    return mapRow(row);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/**
 * Return a claimed decision to the actionable queue when the downstream
 * Tournament service rejects it with a definitive business/validation error.
 * Transient network/5xx failures must remain PROCESSING so the same decision
 * can be retried idempotently.
 */
export async function releaseWithdrawalDecision(input: {
  id: string; decision: "APPROVED" | "REJECTED";
}): Promise<void> {
  await getPool().query(
    `UPDATE team_registration_withdrawal_requests
     SET status='PENDING', desired_decision=NULL, decided_by=NULL, decision_note=NULL, updated_at=NOW()
     WHERE id=$1 AND status='PROCESSING' AND desired_decision=$2`,
    [input.id, input.decision],
  );
}

export async function completeWithdrawalDecision(id: string, expectedDecision: "APPROVED" | "REJECTED"): Promise<WithdrawalRequest> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT wr.*, tr.status AS registration_status
       FROM team_registration_withdrawal_requests wr
       JOIN team_registrations tr ON tr.id=wr.registration_id
       WHERE wr.id=$1 FOR UPDATE OF wr, tr`, [id],
    );
    if (!locked.rowCount) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
    const row = locked.rows[0];
    if (row.status === expectedDecision) {
      await client.query("COMMIT");
      return mapRow(row);
    }
    if (row.status !== "PROCESSING" || row.desired_decision !== expectedDecision) throw new AppError(409, "Withdrawal decision is not in a retryable state", "WITHDRAWAL_REQUEST_NOT_PROCESSING");
    if (row.desired_decision === "APPROVED") {
      if (row.registration_status !== "APPROVED") throw new AppError(409, "Hồ sơ đội không còn ở trạng thái đã duyệt", "REGISTRATION_WITHDRAWAL_CONFLICT");
      await client.query(
        `UPDATE team_registrations SET status='WITHDRAWN', notes=concat_ws(E'\\n\\n', NULLIF(BTRIM(notes), ''), $2), approved_at=NULL, approved_by=NULL WHERE id=$1`,
        [row.registration_id, `BTC đã chấp thuận yêu cầu rút đội: ${row.reason}${row.decision_note?.trim() ? `\\nQuyết định: ${row.decision_note.trim()}` : ""}`],
      );
      await client.query(
        `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
         SELECT id,version,'WITHDRAWN',submitted_roster,$2,$3 FROM team_registrations WHERE id=$1
         ON CONFLICT DO NOTHING`,
        [row.registration_id, row.reason, row.decided_by],
      );
    }
    const result = await client.query(
      `UPDATE team_registration_withdrawal_requests
       SET status=desired_decision, desired_decision=NULL, decided_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND status='PROCESSING' RETURNING *`,
      [id],
    );
    if (!result.rowCount) throw new AppError(409, "Yêu cầu rút đã được xử lý", "WITHDRAWAL_REQUEST_ALREADY_DECIDED");
    await client.query("COMMIT");
    return mapRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

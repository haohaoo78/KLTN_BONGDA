import { randomUUID } from "node:crypto";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import type { RegistrationStatus, TeamRegistration, TeamRegistrationUpdateInput } from "../models/team";
import { markApprovalReviewRevoked } from "./approvalReviewRepository";

export type RegistrationDecisionOutboxItem = {
  id: string;
  registrationId: string;
  teamId: string;
  tournamentId: string;
  institutionId: string | null;
  desiredStatus: "APPROVED" | "REJECTED" | "WITHDRAWN" | "NEEDS_SUPPLEMENT";
  approvedBy: string | null;
  notes: string | null;
  attempts: number;
  sourceStatus: "PENDING" | "WAITLIST" | "APPROVED" | "CONFLICT_ADJUSTMENT_REQUIRED" | "NEEDS_SUPPLEMENT" | "REVISION_REQUIRED";
  actionKind: "DECISION" | "APPROVAL_REVOKED" | "APPROVAL_SUPPLEMENT";
  approvalReviewId: string | null;
  supplementDeadline: string | null;
  resubmissionAllowed?: boolean;
};

function mapRegistration(row: any): TeamRegistration {
  return {
    id: row.id,
    teamId: row.team_id,
    tournamentId: row.tournament_id,
    status: row.status,
    registeredAt: row.registered_at,
    submittedAt: row.submitted_at ?? row.registered_at,
    submissionSequence: Number(row.submission_sequence ?? 0),
    supplementDeadline: row.supplement_deadline ?? null,
    supplementCompletedAt: row.supplement_completed_at ?? null,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    notes: row.notes,
    institutionId: row.institution_id,
    registrationConflicts: Array.isArray(row.registration_conflicts) ? row.registration_conflicts : [],
    adjustmentDeadline: row.adjustment_deadline ?? null,
    resubmissionAllowed: row.resubmission_allowed === true,
  };
}

export async function enqueueRegistrationDecision(
  id: string,
  input: TeamRegistrationUpdateInput,
  approvedBy?: string,
  review?: { approvalReviewId: string; action: "REVOKE_APPROVAL" | "REQUEST_SUPPLEMENT" },
): Promise<{ outboxId: string; registration: TeamRegistration }> {
  if (!input.status || input.status === "PENDING") {
    throw new AppError(400, "A final registration decision is required", "INVALID_STATUS_TRANSITION");
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query<{ team_id: string }>(
      "SELECT team_id FROM team_registrations WHERE id = $1",
      [id],
    );
    if (!identity.rowCount) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
    const teamId = identity.rows[0].team_id;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`team-registration-decision:${teamId}`]);
    await client.query(
      `SELECT id FROM team_registrations WHERE team_id = $1 AND status = 'PENDING' ORDER BY id FOR UPDATE`,
      [teamId],
    );
    const currentResult = await client.query(
      `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.registered_at, tr.submitted_at, tr.submission_sequence,
              tr.supplement_deadline, tr.supplement_completed_at,
              tr.approved_at, tr.approved_by, tr.notes,
              COALESCE(tr.institution_id, t.institution_id) AS institution_id
       FROM team_registrations tr JOIN teams t ON t.id = tr.team_id
       WHERE tr.id = $1 FOR UPDATE OF tr`,
      [id],
    );
    if (!currentResult.rowCount) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
    const current = mapRegistration(currentResult.rows[0]);
    const edit = await client.query(
      `SELECT 1 FROM tournament_registration_drafts WHERE registration_id=$1 AND editing_submitted=TRUE LIMIT 1`, [id],
    );
    if (edit.rowCount) throw new AppError(409, "Đội trưởng đang cập nhật hồ sơ; BTC chỉ có thể quyết định sau khi đội gửi lại hoặc hủy bản chỉnh sửa.", "REGISTRATION_EDIT_IN_PROGRESS");
    const canWithdraw = input.status === "WITHDRAWN" && ["PENDING", "WAITLIST", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(current.status);
    // System expiry is a terminal, auditable rejection of an unfinished
    // supplementation request after its deadline or registration closure.
    // Keep it on the same outbox path so Tournament releases participation
    // claims before Organization commits the local decision.
    const expiresSupplement = approvedBy === "00000000-0000-0000-0000-000000000001"
      && input.status === "REJECTED"
      && ["NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(current.status);
    if (input.status === "APPROVED") {
      const pendingPlayerWithdrawal = await client.query(
        `SELECT 1 FROM tournament_player_withdrawal_requests request
         JOIN tournament_player_invitations invitation ON invitation.id=request.invitation_id
         WHERE invitation.team_id=$1 AND invitation.tournament_id=$2 AND request.status IN ('PENDING','PROCESSING') LIMIT 1`,
        [current.teamId,current.tournamentId],
      );
      if (pendingPlayerWithdrawal.rowCount) {
        throw new AppError(409, "Còn yêu cầu cầu thủ xin rút chưa được đội trưởng xử lý; chưa thể duyệt roster này.", "PLAYER_WITHDRAWAL_REQUEST_PENDING");
      }
    }
    const expiresConflict = current.status === "CONFLICT_ADJUSTMENT_REQUIRED" && input.status === "REJECTED";
    const revokesApproval = review?.action === "REVOKE_APPROVAL" && input.status === "REJECTED" && current.status === "APPROVED";
    const requestsSupplement = review?.action === "REQUEST_SUPPLEMENT" && input.status === "NEEDS_SUPPLEMENT" && current.status === "APPROVED";
    if (!["PENDING", "WAITLIST"].includes(current.status) && !canWithdraw && !revokesApproval && !requestsSupplement && !expiresConflict && !expiresSupplement) {
      throw new AppError(409, "This registration has already received a final decision", "REGISTRATION_ALREADY_DECIDED");
    }
    if (requestsSupplement && (!input.supplementDeadline || new Date(input.supplementDeadline).getTime() <= Date.now())) {
      throw new AppError(400, "Hạn bổ sung phải là thời điểm trong tương lai", "SUPPLEMENT_DEADLINE_REQUIRED");
    }
    if (revokesApproval || requestsSupplement) {
      const openReview = await client.query(
        `SELECT 1 FROM team_registration_approval_reviews WHERE id=$1 AND registration_id=$2 AND status IN ('OPEN','RESPONDED') FOR UPDATE`,
        [review!.approvalReviewId, id],
      );
      if (!openReview.rowCount) throw new AppError(409, "Không tìm thấy yêu cầu xem xét lại đang mở", "APPROVAL_REVIEW_NOT_OPEN");
    }
    const active = await client.query(
      `SELECT 1 FROM team_registration_decision_outbox
       WHERE team_id = $1 AND state IN ('PENDING', 'PROCESSING') LIMIT 1`,
      [teamId],
    );
    if (active.rowCount) {
      throw new AppError(409, "A decision for this team is still synchronizing", "REGISTRATION_DECISION_SYNC_PENDING");
    }
    const outboxId = randomUUID();
    await client.query(
      `INSERT INTO team_registration_decision_outbox
         (id, registration_id, team_id, tournament_id, institution_id, desired_status, approved_by, notes,
          source_status, action_kind, approval_review_id, supplement_deadline,resubmission_allowed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,$13)`,
      [outboxId, id, teamId, current.tournamentId, current.institutionId, input.status, approvedBy ?? null,
        input.notes ?? null, (revokesApproval || requestsSupplement) ? "APPROVED" : current.status,
        revokesApproval ? "APPROVAL_REVOKED" : requestsSupplement ? "APPROVAL_SUPPLEMENT" : "DECISION",
        revokesApproval || requestsSupplement ? review!.approvalReviewId : null, input.supplementDeadline ?? null,input.resubmissionAllowed === true],
    );
    await client.query("COMMIT");
    return { outboxId, registration: current };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimRegistrationDecision(id?: string): Promise<RegistrationDecisionOutboxItem | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id, registration_id, team_id, tournament_id, institution_id, desired_status, supplement_deadline,resubmission_allowed,
              approved_by, notes, attempts, source_status, action_kind, approval_review_id
       FROM team_registration_decision_outbox
       WHERE ($1::uuid IS NULL OR id = $1)
         AND ((state = 'PENDING' AND next_attempt_at <= NOW())
           OR (state = 'PROCESSING' AND locked_at < NOW() - INTERVAL '2 minutes'))
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED LIMIT 1`,
      [id ?? null],
    );
    if (!result.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const row = result.rows[0];
    await client.query(
      `UPDATE team_registration_decision_outbox
       SET state = 'PROCESSING', attempts = attempts + 1, locked_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [row.id],
    );
    await client.query("COMMIT");
    return {
      id: row.id,
      registrationId: row.registration_id,
      teamId: row.team_id,
      tournamentId: row.tournament_id,
      institutionId: row.institution_id,
      desiredStatus: row.desired_status,
      approvedBy: row.approved_by,
      notes: row.notes,
      attempts: Number(row.attempts) + 1,
      sourceStatus: row.source_status,
      actionKind: row.action_kind,
      approvalReviewId: row.approval_review_id,
      supplementDeadline: row.supplement_deadline,
      resubmissionAllowed: row.resubmission_allowed === true,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeRegistrationDecision(
  item: RegistrationDecisionOutboxItem,
  result?: {
    conflictedRegistrations?: Array<{ registrationId: string; conflicts: Array<{ playerId: string; conflictingTournamentId: string; conflictingTournamentName: string }>; adjustmentDeadline: string | null }>;
    waitlistedRegistrationIds?: string[];
  },
): Promise<{ conflictedRegistrations: Array<{ id: string; teamId: string; tournamentId: string; conflicts: Array<{ playerId: string; conflictingTournamentId: string; conflictingTournamentName: string }>; adjustmentDeadline: string | null }>; waitlistedRegistrationIds: string[] }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`team-registration-decision:${item.teamId}`]);
    const changed = await client.query(
      `UPDATE team_registrations
       SET status = $7::varchar, notes = COALESCE($3, notes),
           resubmission_allowed = CASE WHEN $2::varchar='REJECTED' THEN $8::boolean ELSE FALSE END,
           supplement_deadline = CASE WHEN $2::varchar = 'NEEDS_SUPPLEMENT' THEN $6::timestamptz ELSE supplement_deadline END,
           supplement_completed_at = CASE WHEN $2::varchar = 'NEEDS_SUPPLEMENT' THEN NULL ELSE supplement_completed_at END,
           approved_at = CASE WHEN $2::varchar = 'APPROVED' THEN NOW() ELSE NULL END,
           approved_by = CASE WHEN $2::varchar = 'APPROVED' THEN $4::uuid ELSE NULL END
       WHERE id = $1 AND (status = $5 OR ($5 = 'WAITLIST' AND status = 'PENDING'))`,
      [item.registrationId, item.desiredStatus, item.notes, item.approvedBy, item.sourceStatus, item.supplementDeadline,
        item.actionKind === "APPROVAL_REVOKED" ? "APPROVAL_REVOKED" : item.desiredStatus,item.resubmissionAllowed === true],
    );
    if (!changed.rowCount) {
      throw new AppError(409, "Registration changed before its synchronized decision was applied", "REGISTRATION_DECISION_CONFLICT");
    }
    await client.query(
      `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
       SELECT id,version,$2::varchar,submitted_roster,$3,$4
       FROM team_registrations WHERE id=$1
       ON CONFLICT DO NOTHING`,
      [item.registrationId, item.actionKind === "APPROVAL_REVOKED" ? "APPROVAL_REVOKED" : item.desiredStatus,
        item.notes, item.approvedBy],
    );
    if (item.desiredStatus === "WITHDRAWN") {
      // Preserve invite history while ensuring no stale invitation remains
      // actionable after the tournament roster has been withdrawn.
      await client.query(
        `UPDATE tournament_player_invitations
         SET status=CASE WHEN status='PENDING' THEN 'CANCELLED' ELSE 'WITHDRAWN' END,
             status_reason=COALESCE(status_reason,'Đội đã rút hồ sơ khỏi giải'),
             responded_at=COALESCE(responded_at,NOW()),updated_at=NOW()
         WHERE team_id=$1 AND tournament_id=$2 AND status IN ('PENDING','ACCEPTED')`,
        [item.teamId, item.tournamentId],
      );
    }
    if (item.desiredStatus === "REJECTED" && !item.resubmissionAllowed) {
      // A rejected application that cannot be resubmitted must not leave
      // accepted invitations capable of reclaiming participation after roster lock.
      await client.query(
        `UPDATE tournament_player_invitations
         SET status=CASE WHEN status='PENDING' THEN 'CANCELLED' ELSE 'WITHDRAWN' END,
             status_reason=COALESCE(status_reason,'Hồ sơ không được chọn khi chốt danh sách'),
             responded_at=COALESCE(responded_at,NOW()),updated_at=NOW()
         WHERE team_id=$1 AND tournament_id=$2 AND status IN ('PENDING','ACCEPTED')`,
        [item.teamId, item.tournamentId],
      );
    }
    if (item.actionKind === "APPROVAL_REVOKED" && item.approvalReviewId && item.approvedBy) {
      await markApprovalReviewRevoked(client, item.approvalReviewId, item.notes ?? "", item.approvedBy);
    }
    const adjusted: Array<{ id: string; teamId: string; tournamentId: string; conflicts: Array<{ playerId: string; conflictingTournamentId: string; conflictingTournamentName: string }>; adjustmentDeadline: string | null }> = [];
    const conflictedRegistrations = result?.conflictedRegistrations ?? [];
    const waitlistedRegistrationIds = result?.waitlistedRegistrationIds ?? [];
    for (const conflict of conflictedRegistrations) {
      const changedConflict = await client.query<{ id: string; team_id: string; tournament_id: string }>(
        `UPDATE team_registrations SET status='CONFLICT_ADJUSTMENT_REQUIRED',registration_conflicts=$2::jsonb,
           adjustment_deadline=$3::timestamptz,version=version+1,
           notes=concat_ws(E'\\n\\n',NULLIF(BTRIM(notes),''),'Cần điều chỉnh roster: cầu thủ đã được duyệt ở giải có thời gian tổ chức trùng nhau.')
         WHERE id=$1 AND status IN ('PENDING','WAITLIST','NEEDS_SUPPLEMENT','REVISION_REQUIRED') RETURNING id,team_id,tournament_id`,
        [conflict.registrationId, JSON.stringify(conflict.conflicts), conflict.adjustmentDeadline],
      );
      if (!changedConflict.rowCount) continue;
      await client.query(
        `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
         SELECT id,version,'CONFLICT_ADJUSTMENT_REQUIRED',submitted_roster,$2,$3 FROM team_registrations WHERE id=$1
         ON CONFLICT DO NOTHING`,
        [conflict.registrationId, "Tự động trả hồ sơ về đội trưởng để điều chỉnh cầu thủ trùng lịch.", "00000000-0000-0000-0000-000000000001"],
      );
      adjusted.push({ id: changedConflict.rows[0].id, teamId: changedConflict.rows[0].team_id, tournamentId: changedConflict.rows[0].tournament_id, conflicts: conflict.conflicts, adjustmentDeadline: conflict.adjustmentDeadline });
    }
    if (waitlistedRegistrationIds.length) {
      const waitlisted = await client.query<{ id: string; status: string }>(
        `UPDATE team_registrations
         SET status=CASE WHEN status='PENDING' THEN 'WAITLIST' ELSE status END,
             waitlist_reason=NULL,
             notes=concat_ws(E'\\n\\n',NULLIF(BTRIM(notes),''),'Giải hoặc trường đã đủ chỉ tiêu; hồ sơ hoàn thiện được giữ trong danh sách chờ suất.')
         WHERE id=ANY($1::uuid[]) AND status IN ('PENDING','NEEDS_SUPPLEMENT','REVISION_REQUIRED') RETURNING id,status`,
        [waitlistedRegistrationIds],
      );
      for (const entry of waitlisted.rows) {
        await client.query(
          `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
           SELECT id,version,'WAITLISTED',submitted_roster,
             CASE WHEN status='WAITLIST' THEN 'Hồ sơ hoàn thiện đã vào danh sách chờ; BTC có thể xét khi phát sinh suất.'
                  ELSE 'Hồ sơ chưa hoàn thiện cần bổ sung trước khi có thể xét khi phát sinh suất.' END,$2
           FROM team_registrations WHERE id=$1 ON CONFLICT DO NOTHING`,
          [entry.id, item.approvedBy ?? item.registrationId],
        );
      }
    }
    await client.query(
      `UPDATE team_registration_decision_outbox
       SET state = 'SUCCEEDED', locked_at = NULL, last_error = NULL, updated_at = NOW() WHERE id = $1`,
      [item.id],
    );
    await client.query("COMMIT");
    return { conflictedRegistrations: adjusted, waitlistedRegistrationIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function failRegistrationDecision(
  item: RegistrationDecisionOutboxItem,
  error: unknown,
  retryable: boolean,
): Promise<void> {
  const pool = getPool();
  const message = error instanceof Error ? error.message : "Unknown synchronization error";
  const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(item.attempts - 1, 8));
  await pool.query(
    `UPDATE team_registration_decision_outbox
     SET state = $2::varchar, locked_at = NULL, last_error = LEFT($3, 2000),
         next_attempt_at = CASE WHEN $2::varchar = 'PENDING' THEN NOW() + ($4::text || ' seconds')::interval ELSE next_attempt_at END,
         updated_at = NOW()
     WHERE id = $1`,
    [item.id, retryable ? "PENDING" : "FAILED", message, delaySeconds],
  );
}

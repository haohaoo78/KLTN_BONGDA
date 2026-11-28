import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

export type PlayerTournamentWithdrawalRequest = {
  id: string; invitationId: string; playerUserId: string; reason: string;
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED";
  desiredDecision: "APPROVED" | "REJECTED" | null; decisionNote: string | null;
  decidedBy: string | null; createdAt: string; decidedAt: string | null;
  teamId?: string; tournamentId?: string; playerId?: string; playerName?: string;
  teamName?: string; tournamentName?: string | null; position?: string | null;
}

function map(row: any): PlayerTournamentWithdrawalRequest {
  return {
    id: row.id, invitationId: row.invitation_id, playerUserId: row.player_user_id,
    reason: row.reason, status: row.status, desiredDecision: row.desired_decision ?? null,
    decisionNote: row.decision_note ?? null, decidedBy: row.decided_by ?? null,
    createdAt: row.created_at, decidedAt: row.decided_at ?? null,
    ...(row.team_id ? { teamId: row.team_id } : {}),
    ...(row.tournament_id ? { tournamentId: row.tournament_id } : {}),
    ...(row.player_id ? { playerId: row.player_id } : {}),
    ...(row.player_name ? { playerName: row.player_name } : {}),
    ...(row.team_name ? { teamName: row.team_name } : {}),
    ...(row.tournament_name ? { tournamentName: row.tournament_name } : {}),
    ...(row.position_snapshot ? { position: row.position_snapshot } : {}),
  };
}

const requestSelect = `SELECT request.*, invitation.team_id, invitation.tournament_id, invitation.player_id,
    invitation.tournament_name, invitation.position_snapshot, player.full_name AS player_name, team.name AS team_name
  FROM tournament_player_withdrawal_requests request
  JOIN tournament_player_invitations invitation ON invitation.id=request.invitation_id
  JOIN players player ON player.id=invitation.player_id JOIN teams team ON team.id=invitation.team_id`;

export async function createPlayerTournamentWithdrawalRequest(input: { invitationId: string; playerUserId: string; reason: string }) {
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 2000) throw new AppError(400, "Lý do rút xác nhận phải từ 5 đến 2000 ký tự", "WITHDRAWAL_REASON_REQUIRED");
  try {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const tournament = await client.query(
        `SELECT tournament_id FROM tournament_player_invitations WHERE id=$1 AND player_user_id=$2`,
        [input.invitationId,input.playerUserId],
      );
      if (!tournament.rowCount) throw new AppError(404, "Invitation not found", "INVITATION_NOT_FOUND");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`registration-queue:${tournament.rows[0].tournament_id}`]);
      const invitation = await client.query(
        `SELECT invitation.id,invitation.team_id,invitation.tournament_id,invitation.status,
                registration.id AS registration_id,registration.status AS registration_status
         FROM tournament_player_invitations invitation
         LEFT JOIN team_registrations registration
           ON registration.team_id=invitation.team_id AND registration.tournament_id=invitation.tournament_id
         WHERE invitation.id=$1 AND invitation.player_user_id=$2 FOR UPDATE OF invitation`,
        [input.invitationId,input.playerUserId],
      );
      const row = invitation.rows[0];
      if (!row || row.status !== "ACCEPTED") throw new AppError(409, "Chỉ cầu thủ đã xác nhận mới được yêu cầu rút", "INVITATION_NOT_ACCEPTED");
      if (row.registration_status && !["PENDING","REVISION_REQUIRED","NEEDS_SUPPLEMENT","CONFLICT_ADJUSTMENT_REQUIRED"].includes(row.registration_status)) {
        throw new AppError(409, "Chỉ được xin rút khi hồ sơ đội chưa được BTC phê duyệt hoặc roster chưa khóa.", "PLAYER_WITHDRAWAL_NOT_ALLOWED");
      }
      if (row.registration_id) {
        const currentRegistration = await client.query("SELECT id,status FROM team_registrations WHERE id=$1 FOR UPDATE", [row.registration_id]);
        const freshStatus = currentRegistration.rows[0]?.status as string | undefined;
        if (freshStatus && !["PENDING","REVISION_REQUIRED","NEEDS_SUPPLEMENT","CONFLICT_ADJUSTMENT_REQUIRED"].includes(freshStatus)) {
          throw new AppError(409, "Hồ sơ đã được BTC duyệt hoặc roster đã khóa; không thể tạo yêu cầu rút tự nguyện.", "PLAYER_WITHDRAWAL_NOT_ALLOWED");
        }
        const decision = await client.query(
          `SELECT 1 FROM team_registration_decision_outbox WHERE registration_id=$1 AND state IN ('PENDING','PROCESSING') LIMIT 1`,
          [row.registration_id],
        );
        if (decision.rowCount) throw new AppError(409, "BTC đang xử lý quyết định hồ sơ; chưa thể tạo yêu cầu rút.", "REGISTRATION_DECISION_SYNC_PENDING");
      }
      const result = await client.query(
        `INSERT INTO tournament_player_withdrawal_requests(invitation_id,player_user_id,reason)
         VALUES($1,$2,$3) RETURNING *`, [input.invitationId,input.playerUserId,reason],
      );
      await client.query("COMMIT");
      return map(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  } catch (error: any) {
    if (error?.code === "23505") throw new AppError(409, "Yêu cầu rút xác nhận đang chờ đội trưởng xử lý", "WITHDRAWAL_REQUEST_PENDING");
    throw error;
  }
}

export async function listPlayerTournamentWithdrawalRequestsForPlayer(userId: string) {
  const result = await getPool().query(`${requestSelect} WHERE request.player_user_id=$1 ORDER BY request.created_at DESC`, [userId]);
  return result.rows.map(map);
}

export async function listPlayerTournamentWithdrawalRequestsForTeam(teamId: string, tournamentId: string) {
  const result = await getPool().query(`${requestSelect} WHERE invitation.team_id=$1 AND invitation.tournament_id=$2 ORDER BY request.created_at DESC`, [teamId,tournamentId]);
  return result.rows.map(map);
}

export async function getPlayerTournamentWithdrawalRequest(id: string) {
  const result = await getPool().query(`${requestSelect} WHERE request.id=$1`, [id]);
  return result.rowCount ? map(result.rows[0]) : null;
}

export async function beginPlayerTournamentWithdrawalDecision(input: { id: string; decision: "APPROVED" | "REJECTED"; actorId: string; note: string }) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query(
      `SELECT invitation.team_id,invitation.tournament_id FROM tournament_player_withdrawal_requests request
       JOIN tournament_player_invitations invitation ON invitation.id=request.invitation_id WHERE request.id=$1`, [input.id],
    );
    if (!identity.rowCount) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
    const registration = await client.query(
      `SELECT id,status FROM team_registrations WHERE team_id=$1 AND tournament_id=$2 FOR UPDATE`,
      [identity.rows[0].team_id,identity.rows[0].tournament_id],
    );
    if (input.decision === "APPROVED" && registration.rowCount && !["PENDING","REVISION_REQUIRED","NEEDS_SUPPLEMENT","CONFLICT_ADJUSTMENT_REQUIRED"].includes(registration.rows[0].status)) {
      throw new AppError(409, "Hồ sơ đã được BTC duyệt hoặc roster đã khóa; không thể xử lý yêu cầu rút tự nguyện.", "PLAYER_WITHDRAWAL_NOT_ALLOWED");
    }
    const current = await client.query(`SELECT * FROM tournament_player_withdrawal_requests WHERE id=$1 FOR UPDATE`, [input.id]);
    if (!current.rowCount) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
    const row = current.rows[0];
    if (row.status === input.decision) { await client.query("COMMIT"); return map(row); }
    if (row.status === "PENDING") {
      const updated = await client.query(
        `UPDATE tournament_player_withdrawal_requests SET status='PROCESSING',desired_decision=$2,
         decision_note=NULLIF(BTRIM($3),''),decided_by=$4,updated_at=NOW() WHERE id=$1 RETURNING *`,
        [input.id,input.decision,input.note,input.actorId],
      );
      await client.query("COMMIT"); return map(updated.rows[0]);
    }
    if (row.status !== "PROCESSING" || row.desired_decision !== input.decision) throw new AppError(409, "Yêu cầu đã được xử lý hoặc đang có quyết định khác", "WITHDRAWAL_REQUEST_ALREADY_DECIDED");
    await client.query("COMMIT"); return map(row);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function releasePlayerTournamentWithdrawalDecision(id: string, decision: "APPROVED" | "REJECTED") {
  await getPool().query(`UPDATE tournament_player_withdrawal_requests SET status='PENDING',desired_decision=NULL,decision_note=NULL,decided_by=NULL,updated_at=NOW()
    WHERE id=$1 AND status='PROCESSING' AND desired_decision=$2`, [id,decision]);
}

export async function completePlayerTournamentWithdrawalDecision(id: string, decision: "APPROVED" | "REJECTED", actorId: string, note: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const identity = await client.query(
      `SELECT invitation.team_id,invitation.tournament_id FROM tournament_player_withdrawal_requests request
       JOIN tournament_player_invitations invitation ON invitation.id=request.invitation_id WHERE request.id=$1`, [id],
    );
    if (!identity.rowCount) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
    await client.query("SELECT id FROM team_registrations WHERE team_id=$1 AND tournament_id=$2 FOR UPDATE", [identity.rows[0].team_id,identity.rows[0].tournament_id]);
    const result = await client.query(
      `SELECT request.*, invitation.status AS invitation_status,invitation.team_id,invitation.tournament_id,
              invitation.player_id,registration.id AS registration_id,registration.status AS registration_status,
              registration.version AS registration_version,registration.submitted_roster
       FROM tournament_player_withdrawal_requests request
       JOIN tournament_player_invitations invitation ON invitation.id=request.invitation_id
       LEFT JOIN team_registrations registration ON registration.team_id=invitation.team_id AND registration.tournament_id=invitation.tournament_id
       WHERE request.id=$1 FOR UPDATE OF request,invitation`, [id],
    );
    if (!result.rowCount) throw new AppError(404, "Withdrawal request not found", "WITHDRAWAL_REQUEST_NOT_FOUND");
    const row = result.rows[0];
    if (row.status === decision) { await client.query("COMMIT"); return map(row); }
    if (row.status !== "PROCESSING" || row.desired_decision !== decision) throw new AppError(409, "Yêu cầu không ở trạng thái đang xử lý quyết định này", "WITHDRAWAL_REQUEST_NOT_PROCESSING");
    if (decision === "APPROVED") {
      if (row.invitation_status !== "ACCEPTED") throw new AppError(409, "Lời mời không còn ở roster đã xác nhận", "INVITATION_WITHDRAWAL_CONFLICT");
      if (row.registration_status && !["PENDING","REVISION_REQUIRED","NEEDS_SUPPLEMENT","CONFLICT_ADJUSTMENT_REQUIRED"].includes(row.registration_status)) {
        throw new AppError(409, "Hồ sơ đã được BTC duyệt hoặc roster đã khóa; không thể xử lý yêu cầu rút tự nguyện.", "PLAYER_WITHDRAWAL_NOT_ALLOWED");
      }
      if (row.registration_id) {
        const existingDraft = await client.query(
          `SELECT roster FROM tournament_registration_drafts WHERE team_id=$1 AND tournament_id=$2 FOR UPDATE`,
          [row.team_id,row.tournament_id],
        );
        const roster = Array.isArray(row.submitted_roster) ? row.submitted_roster as Array<Record<string, unknown>> : [];
        const remaining = roster.filter((entry) => String(entry.playerId ?? entry.player_id ?? "") !== row.player_id);
        if (remaining.length === roster.length) throw new AppError(409, "Cầu thủ không có trong snapshot hồ sơ hiện tại", "PLAYER_WITHDRAWAL_ROSTER_CONFLICT");
        const isPendingSubmission = row.registration_status === "PENDING";
        // A PENDING submission is an immutable snapshot for BTC. Accepting a
        // player withdrawal starts a separate editable draft and leaves both
        // that snapshot and the registration status/version untouched.
        const updatedRegistration = isPendingSubmission
          ? { rows: [{ version: row.registration_version }] }
          : await client.query(
              `UPDATE team_registrations SET submitted_roster=$2::jsonb,status=$3,
                 notes=concat_ws(E'\\n\\n',NULLIF(BTRIM(notes),''),$4::text),version=version+1
               WHERE id=$1 RETURNING version`,
              [row.registration_id,JSON.stringify(remaining),row.registration_status,`Cầu thủ đã rút xác nhận theo yêu cầu được đội trưởng chấp thuận. Cần gửi lại roster mới nhất.`],
            );
        await client.query(
          `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
           VALUES($1,$2,'PLAYER_WITHDRAWAL_ACCEPTED',$3::jsonb,$4,$5)`,
          [row.registration_id,updatedRegistration.rows[0].version,JSON.stringify(remaining),
            isPendingSubmission
              ? `DRAFT_CHANGES: đội trưởng chấp thuận cầu thủ ${row.player_id} rút; snapshot PENDING vẫn được giữ nguyên. ${note}`.trim()
              : note || `Yêu cầu rút của cầu thủ ${row.player_id} được chấp thuận.`,actorId],
        );
        const submittedDraftRoster = remaining.map((entry) => ({
            playerId: String(entry.playerId ?? entry.player_id),
            competitionRole: entry.competitionRole ?? entry.competition_role ?? "PLAYER",
            lineupRole: entry.lineupRole ?? entry.lineup_role ?? "STARTER",
            isGoalkeeper: entry.isGoalkeeper ?? entry.is_goalkeeper ?? false,
            proposedJerseyNumber: entry.jerseyNumber ?? entry.proposedJerseyNumber ?? entry.jersey_number ?? null,
            position: entry.position ?? entry.positionSnapshot ?? entry.position_snapshot ?? null,
          }));
        const draftRoster = existingDraft.rowCount && Array.isArray(existingDraft.rows[0].roster)
          ? (existingDraft.rows[0].roster as Array<Record<string, unknown>>).filter((entry) => String(entry.playerId ?? entry.player_id ?? "") !== row.player_id)
          : submittedDraftRoster;
        await client.query(
          `INSERT INTO tournament_registration_drafts(team_id,tournament_id,updated_by,roster,notes,registration_id,base_version,editing_submitted,draft_state)
           VALUES($1,$2,$3,$4::jsonb,'',$5,$6,$7,$8)
           ON CONFLICT(team_id,tournament_id) DO UPDATE SET updated_by=EXCLUDED.updated_by,roster=EXCLUDED.roster,
             registration_id=EXCLUDED.registration_id,base_version=EXCLUDED.base_version,
             editing_submitted=EXCLUDED.editing_submitted,draft_state=EXCLUDED.draft_state,updated_at=NOW()`,
          [row.team_id,row.tournament_id,actorId,JSON.stringify(draftRoster),row.registration_id,updatedRegistration.rows[0].version,isPendingSubmission || row.registration_status === "PENDING",isPendingSubmission || row.registration_status === "PENDING" ? "DRAFT_CHANGES" : "DRAFT"],
        );
      } else {
        await client.query(
          `UPDATE tournament_registration_drafts SET roster=COALESCE((SELECT jsonb_agg(item) FROM jsonb_array_elements(roster) item
             WHERE COALESCE(item->>'playerId',item->>'player_id')<>$3), '[]'::jsonb),updated_at=NOW()
           WHERE team_id=$1 AND tournament_id=$2`, [row.team_id,row.tournament_id,row.player_id],
        );
      }
      await client.query(`UPDATE tournament_player_invitations SET status='WITHDRAWN',status_reason=$2,responded_at=NOW(),updated_at=NOW() WHERE id=$1`,
        [row.invitation_id, `Đội trưởng chấp thuận yêu cầu rút: ${row.reason}${row.decision_note ? ` · ${row.decision_note}` : ""}`]);
    }
    const updated = await client.query(`UPDATE tournament_player_withdrawal_requests SET status=$2,desired_decision=NULL,decision_note=NULLIF(BTRIM($3),''),decided_by=$4,decided_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`, [id,decision,note,actorId]);
    await client.query("COMMIT"); return map(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

export type RegistrationChangeKind = "APPROVED_AMENDMENT" | "LOCKED_PLAYER_ADDITION";
export type RegistrationChangeRequest = {
  id: string; registrationId: string; requestKind: RegistrationChangeKind; status: string;
  baseVersion: number; previousRoster: Array<Record<string, unknown>>; proposedRoster: Array<Record<string, unknown>>;
  reason: string; requestedBy: string; desiredDecision: string | null; decidedBy: string | null;
  decisionNote: string | null; createdAt: string; decidedAt: string | null; effectiveAt: string | null;
};
const map = (r: Record<string, unknown>): RegistrationChangeRequest => ({
  id: String(r.id), registrationId: String(r.registration_id), requestKind: r.request_kind as RegistrationChangeKind,
  status: String(r.status), baseVersion: Number(r.base_version), previousRoster: r.previous_roster as Array<Record<string, unknown>>,
  proposedRoster: r.proposed_roster as Array<Record<string, unknown>>, reason: String(r.reason), requestedBy: String(r.requested_by),
  desiredDecision: r.desired_decision ? String(r.desired_decision) : null, decidedBy: r.decided_by ? String(r.decided_by) : null,
  decisionNote: r.decision_note ? String(r.decision_note) : null, createdAt: new Date(String(r.created_at)).toISOString(),
  decidedAt: r.decided_at ? new Date(String(r.decided_at)).toISOString() : null,
  effectiveAt: r.effective_at ? new Date(String(r.effective_at)).toISOString() : null,
});

export async function getChangeRequestRegistration(id: string) {
  const r = await getPool().query(`SELECT id,team_id,tournament_id,status,version,submitted_roster FROM team_registrations WHERE id=$1`, [id]);
  return r.rows[0] ?? null;
}
export async function createRegistrationChangeRequest(input: {
  registrationId: string; requestKind: RegistrationChangeKind; requestedBy: string; reason: string;
  proposedRoster: Array<Record<string, unknown>>;
}) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const q = await client.query(`SELECT id,team_id,tournament_id,status,version,submitted_roster FROM team_registrations WHERE id=$1 FOR UPDATE`, [input.registrationId]);
    if (!q.rowCount) throw new AppError(404, "Không tìm thấy hồ sơ đăng ký", "REGISTRATION_NOT_FOUND");
    const r = q.rows[0];
    if (r.status !== "APPROVED") throw new AppError(409, "Chỉ hồ sơ đã được duyệt mới được gửi đề xuất thay đổi", "REGISTRATION_NOT_APPROVED");
    const previous = Array.isArray(r.submitted_roster) ? r.submitted_roster as Array<Record<string, unknown>> : [];
    const oldIds = previous.map((x) => String(x.playerId ?? x.player_id ?? "")).filter(Boolean).sort();
    const newIds = input.proposedRoster.map((x) => String(x.playerId ?? x.player_id ?? "")).filter(Boolean).sort();
    if (!newIds.length || new Set(newIds).size !== newIds.length) throw new AppError(400, "Roster đề xuất phải có cầu thủ hợp lệ, không trùng", "INVALID_PROPOSED_ROSTER");
    if (input.requestKind === "LOCKED_PLAYER_ADDITION" && (newIds.length !== oldIds.length + 1 || oldIds.some((id) => !newIds.includes(id))))
      throw new AppError(400, "Sau khi khóa roster chỉ được đề xuất bổ sung đúng một cầu thủ", "LOCKED_ROSTER_ADDITION_ONLY");
    const changed = await client.query(`INSERT INTO team_registration_change_requests
      (registration_id,request_kind,base_version,previous_roster,proposed_roster,reason,requested_by)
      VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,
      [input.registrationId,input.requestKind,r.version,JSON.stringify(previous),JSON.stringify(input.proposedRoster),input.reason.trim(),input.requestedBy]);
    await client.query(`INSERT INTO team_registration_change_request_events(request_id,event_type,actor_id,note) VALUES($1,'REQUESTED',$2,$3)`, [changed.rows[0].id,input.requestedBy,input.reason.trim()]);
    await client.query("COMMIT"); return map(changed.rows[0]);
  } catch (e) { await client.query("ROLLBACK"); if ((e as { code?: string }).code === "23505") throw new AppError(409,"Đã có yêu cầu thay đổi roster đang chờ xử lý","CHANGE_REQUEST_ALREADY_OPEN"); throw e; }
  finally { client.release(); }
}
export async function listRegistrationChangeRequests(tournamentId: string) {
  const r = await getPool().query(`SELECT cr.* FROM team_registration_change_requests cr JOIN team_registrations tr ON tr.id=cr.registration_id WHERE tr.tournament_id=$1 ORDER BY (cr.status IN ('PENDING','PROCESSING')) DESC,cr.created_at DESC`, [tournamentId]);
  return r.rows.map(map);
}
export async function listRegistrationChangeRequestsForRegistration(registrationId: string) {
  const r = await getPool().query(`SELECT * FROM team_registration_change_requests WHERE registration_id=$1 ORDER BY created_at DESC`,[registrationId]);
  return r.rows.map(map);
}
export async function getRegistrationChangeRequestById(id: string) {
  const r = await getPool().query(`SELECT * FROM team_registration_change_requests WHERE id=$1`,[id]);
  return r.rows[0] ? map(r.rows[0]) : null;
}
export async function resetRegistrationChangeDecision(id: string, actorId: string, note: string) {
  await getPool().query(`UPDATE team_registration_change_requests SET status='PENDING',desired_decision=NULL,decided_by=NULL,decision_note=NULL WHERE id=$1 AND status='PROCESSING'`,[id]);
  await getPool().query(`INSERT INTO team_registration_change_request_events(request_id,event_type,actor_id,note) VALUES($1,'DECISION_RETRYABLE',$2,$3)`,[id,actorId,note.slice(0,2000)]);
}
export async function decideRegistrationChangeRequest(input: { id: string; actorId: string; decision: "APPROVED" | "REJECTED"; note: string }) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT cr.*,tr.status AS registration_status,tr.version AS registration_version,tr.submitted_roster AS current_roster,tr.tournament_id,tr.team_id
      FROM team_registration_change_requests cr JOIN team_registrations tr ON tr.id=cr.registration_id WHERE cr.id=$1 FOR UPDATE OF cr,tr`, [input.id]);
    if (!result.rowCount) throw new AppError(404,"Không tìm thấy yêu cầu thay đổi","CHANGE_REQUEST_NOT_FOUND");
    const r = result.rows[0];
    if (r.status === input.decision) { await client.query("COMMIT"); return map(r); }
    if (r.status === "PROCESSING" && r.desired_decision === input.decision) { await client.query("COMMIT"); return map(r); }
    if (r.status !== "PENDING") throw new AppError(409,"Yêu cầu đã được xử lý hoặc đang được xử lý","CHANGE_REQUEST_NOT_PENDING");
    if (r.registration_status !== "APPROVED" || Number(r.registration_version) !== Number(r.base_version)) throw new AppError(409,"Hồ sơ đã thay đổi; cần tải lại trước khi quyết định","CHANGE_REQUEST_VERSION_CONFLICT");
    const pending = await client.query(`UPDATE team_registration_change_requests SET status='PROCESSING',desired_decision=$2,decided_by=$3,decision_note=$4 WHERE id=$1 AND status='PENDING' RETURNING *`,[input.id,input.decision,input.actorId,input.note.trim()]);
    await client.query(`INSERT INTO team_registration_change_request_events(request_id,event_type,actor_id,note) VALUES($1,$2,$3,$4)`,[input.id,input.decision==="APPROVED"?"APPROVAL_STARTED":"REJECTION_STARTED",input.actorId,input.note.trim()]);
    await client.query("COMMIT"); return map(pending.rows[0]);
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function finalizeRegistrationChangeRequest(input: { id: string; actorId: string; decision: "APPROVED" | "REJECTED"; note: string }) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT cr.*,tr.version AS registration_version,tr.status AS registration_status FROM team_registration_change_requests cr JOIN team_registrations tr ON tr.id=cr.registration_id WHERE cr.id=$1 FOR UPDATE OF cr,tr`,[input.id]);
    if (!result.rowCount) throw new AppError(404,"Không tìm thấy yêu cầu thay đổi","CHANGE_REQUEST_NOT_FOUND");
    const r=result.rows[0];
    if (r.status === input.decision) { await client.query("COMMIT"); return map(r); }
    if (r.status !== "PROCESSING" || r.desired_decision !== input.decision) throw new AppError(409,"Quyết định chưa được khởi tạo hoặc đã đổi","CHANGE_REQUEST_DECISION_CONFLICT");
    if (input.decision === "APPROVED") {
      if (r.registration_status !== "APPROVED" || Number(r.registration_version)!==Number(r.base_version)) throw new AppError(409,"Phiên bản hồ sơ đã thay đổi","CHANGE_REQUEST_VERSION_CONFLICT");
      const nextVersion=Number(r.registration_version)+1;
      const action=r.request_kind === "LOCKED_PLAYER_ADDITION" ? "LOCKED_ROSTER_PLAYER_ADDED" : "APPROVED_ROSTER_AMENDED";
      await client.query(`UPDATE team_registrations SET submitted_roster=$2::jsonb,version=$3,updated_at=NOW() WHERE id=$1`,[r.registration_id,JSON.stringify(r.proposed_roster),nextVersion]);
      await client.query(`INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id) VALUES($1,$2,$3,$4::jsonb,$5,$6)`,[r.registration_id,nextVersion,action,JSON.stringify(r.proposed_roster),`${r.reason}\n${input.note.trim()}`,input.actorId]);
    }
    const done=await client.query(`UPDATE team_registration_change_requests SET status=$2,decided_by=$3,decision_note=$4,decided_at=NOW(),effective_at=CASE WHEN $2='APPROVED' THEN NOW() ELSE NULL END WHERE id=$1 RETURNING *`,[input.id,input.decision,input.actorId,input.note.trim()]);
    await client.query(`INSERT INTO team_registration_change_request_events(request_id,event_type,actor_id,note) VALUES($1,$2,$3,$4)`,[input.id,input.decision==="APPROVED"?"APPROVED":"REJECTED",input.actorId,input.note.trim()]);
    await client.query("COMMIT"); return map(done.rows[0]);
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

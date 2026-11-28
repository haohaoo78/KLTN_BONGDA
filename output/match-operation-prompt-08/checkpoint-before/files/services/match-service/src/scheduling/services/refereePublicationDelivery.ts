import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { config } from "../../config";
import { getPool } from "../lib/db";
import { AppError } from "../../lib/errors";
import { parseRefereeRequestId } from "./refereeTeamValidation";
import { refereeAssignmentAccess } from "./refereeAssignmentService";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";

export interface AssignmentMessagePayload {
  email: string; fullName: string; tournamentId: string; tournamentName: string; matchId: string; matchLabel: string;
  position: string; scheduledAt: string; venueName: string; location: string; kind: "PUBLISHED" | "REPLACED_IN" | "REPLACED_OUT"; reason?: string;
}
export async function enqueueRefereeMessage(client: PoolClient, scheduleId: string, version: number, refereeId: string, position: string, payload: AssignmentMessagePayload, requestedBy: string) {
  const id = randomUUID();
  await client.query(`INSERT INTO referee_assignment_messages(id,schedule_id,publication_revision,referee_id,position,kind,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`, [id, scheduleId, version, refereeId, position, payload.kind, JSON.stringify(payload)]);
  await client.query("INSERT INTO referee_assignment_email_attempts(id,message_id,request_id,requested_by) VALUES($1,$2,$2,$3)", [randomUUID(), id, requestedBy]);
  return id;
}

/** Only explicit publish/replace/resend calls dispatch. Reads never send messages. */
export async function dispatchRefereeMessages(messageIds: string[], reconcile = false): Promise<void> {
  for (const id of messageIds) {
    const message = (await getPool().query("SELECT * FROM referee_assignment_messages WHERE id=$1", [id])).rows[0];
    if (!message) continue;
    const payload = message.payload as AssignmentMessagePayload;
    const latest = (await getPool().query("SELECT slots FROM schedule_referee_publications WHERE schedule_id=$1 AND voided_at IS NULL ORDER BY revision DESC LIMIT 1", [message.schedule_id])).rows[0];
    const stillAssigned = latest?.slots.some((slot: { position: string; refereeId: string }) => slot.position === message.position && slot.refereeId === message.referee_id);
    if (latest && (payload.kind === "REPLACED_OUT" ? stillAssigned : !stillAssigned)) {
      await getPool().query("UPDATE referee_assignment_email_attempts SET status='FAILED',error_code='EMAIL_SUPERSEDED',updated_at=NOW() WHERE message_id=$1 AND status='PENDING' AND dispatched_at IS NULL", [id]);
      await getPool().query("UPDATE referee_assignment_messages SET notification_status='FAILED' WHERE id=$1 AND notification_status='PENDING'", [id]);
      continue;
    }
    if (message.notification_status !== "SENT") {
      try {
        const response = await fetch(new URL("/internal/notifications", config.notificationServiceUrl), { method: "POST", headers: { "content-type": "application/json", "x-internal-api-key": config.internalApiKey }, signal: AbortSignal.timeout(8000), body: JSON.stringify({
          userId: message.referee_id, type: "SYSTEM", title: payload.kind === "REPLACED_OUT" ? "Phân công trọng tài đã được thay thế" : "Phân công trọng tài chính thức",
          body: `${payload.tournamentName} · ${payload.matchLabel} · ${payload.position} · ${payload.scheduledAt} · ${payload.venueName}${payload.reason ? ` · Lý do: ${payload.reason}` : ""}`,
          data: { category: "MATCH_OFFICIAL_ASSIGNMENT", tournamentId: payload.tournamentId, matchId: payload.matchId, scheduleId: message.schedule_id, publicationRevision: message.publication_revision, kind: payload.kind }, idempotencyKey: `referee-assignment:${id}`,
        }) });
        await getPool().query("UPDATE referee_assignment_messages SET notification_status=$2 WHERE id=$1", [id, response.ok ? "SENT" : "FAILED"]);
      } catch { await getPool().query("UPDATE referee_assignment_messages SET notification_status='FAILED' WHERE id=$1", [id]); }
    }
    const attempt = (await getPool().query("SELECT * FROM referee_assignment_email_attempts WHERE message_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [id])).rows[0];
    if (!attempt || attempt.status === "SENT" || attempt.status === "FAILED" || attempt.dispatched_at && !reconcile) continue;
    if (!reconcile && !(await getPool().query("UPDATE referee_assignment_email_attempts SET dispatched_at=NOW() WHERE id=$1 AND dispatched_at IS NULL RETURNING id", [attempt.id])).rowCount) continue;
    try {
      const response = await fetch(new URL("/internal/email/referee-assignment", config.notificationServiceUrl), { method: "POST", headers: { "content-type": "application/json", "x-internal-api-key": config.internalApiKey }, signal: AbortSignal.timeout(45000), body: JSON.stringify({ ...payload, eventKey: `referee-assignment:${attempt.id}` }) });
      if (!response.ok) throw new Error("Delivery result unavailable");
      const result = await response.json() as { status?: string; errorCode?: string; sentAt?: string };
      if (!["PENDING", "SENT", "FAILED"].includes(result.status ?? "")) throw new Error("Invalid delivery result");
      const errorCode = result.errorCode && /^[A-Z0-9_]{1,64}$/.test(result.errorCode) ? result.errorCode : null;
      await getPool().query("UPDATE referee_assignment_email_attempts SET status=$2,error_code=$3,sent_at=$4,updated_at=NOW() WHERE id=$1", [attempt.id, result.status, errorCode, result.sentAt && Number.isFinite(Date.parse(result.sentAt)) ? result.sentAt : null]);
    } catch {
      await getPool().query("UPDATE referee_assignment_email_attempts SET error_code='EMAIL_STATUS_UNCERTAIN',updated_at=NOW() WHERE id=$1 AND status='PENDING'", [attempt.id]);
    }
  }
}

export async function resendRefereePublicationEmail(actor: AuthenticatedRequest, tournamentId: string, matchId: string, value: unknown) {
  parseRefereeRequestId(matchId);
  const input = value as { requestId?: unknown; expectedPublicationRevision?: unknown };
  if (!input || typeof input !== "object" || Object.keys(input).some((key) => !["requestId", "expectedPublicationRevision"].includes(key)) || !Number.isSafeInteger(input.expectedPublicationRevision)) throw new AppError(400, "Yêu cầu gửi lại không hợp lệ.", "REFEREE_RESEND_INVALID");
  const requestId = parseRefereeRequestId(input.requestId);
  const access = await refereeAssignmentAccess(actor, tournamentId);
  if (access.readOnlyReason) throw new AppError(409, access.readOnlyReason, "REFEREE_PUBLICATION_READ_ONLY");
  const client = await getPool().connect(); let ids: string[] = [];
  try {
    await client.query("BEGIN");
    const schedule = (await client.query("SELECT id FROM schedules WHERE match_id=$1 AND tournament_id=$2 AND status='PUBLISHED' FOR UPDATE", [matchId, tournamentId])).rows[0];
    if (!schedule) throw new AppError(404, "Không tìm thấy lịch chính thức của trận.", "REFEREE_DRAFT_MATCH_NOT_FOUND");
    const publication = (await client.query("SELECT revision FROM schedule_referee_publications WHERE schedule_id=$1 AND voided_at IS NULL ORDER BY revision DESC LIMIT 1", [schedule.id])).rows[0];
    if (!publication || publication.revision !== input.expectedPublicationRevision) throw new AppError(409, "Phiên bản công bố đã thay đổi. Tải lại trước khi gửi.", "REFEREE_PUBLICATION_REVISION_CONFLICT");
    const messages = await client.query("SELECT id FROM referee_assignment_messages WHERE schedule_id=$1 AND publication_revision=$2 ORDER BY id FOR UPDATE", [schedule.id, publication.revision]);
    ids = messages.rows.map((row) => row.id);
    for (const id of ids) {
      const latest = (await client.query("SELECT * FROM referee_assignment_email_attempts WHERE message_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [id])).rows[0];
      if (latest?.status !== "FAILED") continue;
      // Repeating one request ID cannot create another SMTP attempt.
      await client.query("INSERT INTO referee_assignment_email_attempts(id,message_id,request_id,requested_by) VALUES($1,$2,$3,$4) ON CONFLICT(message_id,request_id) DO NOTHING", [randomUUID(), id, requestId, actor.userId]);
    }
    await client.query("UPDATE referee_assignment_email_attempts SET dispatched_at=NULL WHERE message_id=ANY($1::uuid[]) AND status='PENDING'", [ids]);
    await client.query("UPDATE referee_assignment_messages SET notification_status='PENDING' WHERE id=ANY($1::uuid[]) AND notification_status='FAILED'", [ids]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return { messageIds: ids };
}

let deliveryTimer: ReturnType<typeof setInterval> | null = null;
let running: Promise<void> | null = null;
export function startRefereeAssignmentDeliveryWorker(): void {
  if (deliveryTimer) return;
  const tick = () => {
    if (running) return;
    running = (async () => {
      const result = await getPool().query(`SELECT DISTINCT m.id,m.created_at FROM referee_assignment_messages m
        LEFT JOIN referee_assignment_email_attempts a ON a.message_id=m.id
        WHERE m.notification_status='PENDING' OR (a.status='PENDING' AND a.dispatched_at IS NULL) ORDER BY m.created_at,m.id LIMIT 20`);
      for (let offset = 0; offset < result.rows.length; offset += 4) await Promise.all(result.rows.slice(offset, offset + 4).map((row) => dispatchRefereeMessages([row.id])));
    })().catch(() => { console.error("[match-service] referee delivery worker could not process pending messages"); }).finally(() => { running = null; });
  };
  deliveryTimer = setInterval(tick, 2000); deliveryTimer.unref(); tick();
}
export async function stopRefereeAssignmentDeliveryWorker(): Promise<void> {
  if (deliveryTimer) clearInterval(deliveryTimer); deliveryTimer = null;
  if (running) await running;
}

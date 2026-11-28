import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

export type ApprovalReviewStatus = "OPEN" | "RESPONDED" | "RETAINED" | "REVOKED" | "SUPPLEMENT_REQUIRED";
export type ApprovalReviewEvent = {
  id: string;
  reviewId: string;
  registrationId: string;
  eventType: "OPENED" | "TEAM_RESPONDED" | "SUPPLEMENT_REQUESTED" | "RETAINED" | "REVOKED";
  statusBefore: string;
  statusAfter: string;
  actorId: string;
  note: string | null;
  rosterSnapshot: unknown[];
  createdAt: string;
};
export type ApprovalReview = {
  id: string;
  registrationId: string;
  requestedBy: string;
  reason: string;
  responseDeadline: string;
  supplementDeadline: string | null;
  status: ApprovalReviewStatus;
  teamResponse: string | null;
  respondedAt: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  events?: ApprovalReviewEvent[];
};

function mapReviewEvent(row: any): ApprovalReviewEvent {
  return { id: row.id, reviewId: row.review_id, registrationId: row.registration_id,
    eventType: row.event_type, statusBefore: row.status_before, statusAfter: row.status_after,
    actorId: row.actor_id, note: row.note, rosterSnapshot: row.roster_snapshot ?? [], createdAt: row.created_at };
}

async function insertReviewEvent(client: import("pg").PoolClient, input: Omit<ApprovalReviewEvent, "id" | "createdAt">): Promise<void> {
  await client.query(
    `INSERT INTO team_registration_approval_review_events
       (review_id,registration_id,event_type,status_before,status_after,actor_id,note,roster_snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [input.reviewId, input.registrationId, input.eventType, input.statusBefore, input.statusAfter,
      input.actorId, input.note, JSON.stringify(input.rosterSnapshot ?? [])],
  );
}

function mapReview(row: any): ApprovalReview {
  return {
    id: row.id,
    registrationId: row.registration_id,
    requestedBy: row.requested_by,
    reason: row.reason,
    responseDeadline: row.response_deadline,
    supplementDeadline: row.supplement_deadline ?? null,
    status: row.status,
    teamResponse: row.team_response,
    respondedAt: row.responded_at,
    decisionNote: row.decision_note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
  };
}

export async function createApprovalReview(input: {
  registrationId: string; requestedBy: string; reason: string; responseDeadline: string;
}): Promise<ApprovalReview> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const registration = await client.query(
      "SELECT id, status, version, submitted_roster FROM team_registrations WHERE id=$1 FOR UPDATE",
      [input.registrationId],
    );
    const row = registration.rows[0];
    if (!row) throw new AppError(404, "Team registration not found", "REGISTRATION_NOT_FOUND");
    if (row.status !== "APPROVED") throw new AppError(409, "Chỉ hồ sơ đã duyệt mới được xem xét lại", "REGISTRATION_NOT_APPROVED");
    const result = await client.query(
      `INSERT INTO team_registration_approval_reviews(registration_id,requested_by,reason,response_deadline)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [input.registrationId, input.requestedBy, input.reason.trim(), input.responseDeadline],
    );
    const review = result.rows[0];
    await client.query(
      `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
       VALUES($1,$2,'APPROVAL_REVIEW_OPENED',$3::jsonb,$4,$5)`,
      [input.registrationId, row.version, JSON.stringify(row.submitted_roster ?? []), `${input.reason.trim()}\nHạn phản hồi: ${input.responseDeadline}`, input.requestedBy],
    );
    await insertReviewEvent(client, { reviewId: review.id, registrationId: input.registrationId,
      eventType: "OPENED", statusBefore: "APPROVED", statusAfter: "OPEN", actorId: input.requestedBy,
      note: input.reason.trim(), rosterSnapshot: row.submitted_roster ?? [] });
    await client.query("COMMIT");
    return mapReview(review);
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error?.code === "23505") throw new AppError(409, "Đội đang có yêu cầu xem xét lại chưa hoàn tất", "APPROVAL_REVIEW_PENDING");
    throw error;
  } finally { client.release(); }
}

export async function listApprovalReviews(registrationId: string): Promise<ApprovalReview[]> {
  const result = await getPool().query(
    "SELECT * FROM team_registration_approval_reviews WHERE registration_id=$1 ORDER BY created_at DESC",
    [registrationId],
  );
  if (!result.rows.length) return [];
  const events = await getPool().query(
    `SELECT * FROM team_registration_approval_review_events
     WHERE review_id = ANY($1::uuid[]) ORDER BY created_at,id`, [result.rows.map((row) => row.id)],
  );
  const eventsByReview = new Map<string, ApprovalReviewEvent[]>();
  for (const row of events.rows) {
    const event = mapReviewEvent(row);
    eventsByReview.set(event.reviewId, [...(eventsByReview.get(event.reviewId) ?? []), event]);
  }
  return result.rows.map((row) => ({ ...mapReview(row), events: eventsByReview.get(row.id) ?? [] }));
}

export async function countOpenApprovalReviews(tournamentId: string): Promise<number> {
  const result = await getPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM team_registration_approval_reviews review
     JOIN team_registrations registration ON registration.id=review.registration_id
       WHERE registration.tournament_id=$1 AND registration.status='APPROVED'
         AND review.status IN ('OPEN','RESPONDED','SUPPLEMENT_REQUIRED')`, [tournamentId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function findApprovalReview(id: string): Promise<(ApprovalReview & { teamId: string; tournamentId: string; captainId: string; registrationStatus: string; version: number; roster: unknown }) | null> {
  const result = await getPool().query(
    `SELECT review.*, registration.team_id, registration.tournament_id, registration.status AS registration_status,
            registration.version, registration.submitted_roster, team.captain_id
     FROM team_registration_approval_reviews review
     JOIN team_registrations registration ON registration.id=review.registration_id
     JOIN teams team ON team.id=registration.team_id
     WHERE review.id=$1`, [id],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return { ...mapReview(row), teamId: row.team_id, tournamentId: row.tournament_id,
    captainId: row.captain_id, registrationStatus: row.registration_status,
    version: Number(row.version), roster: row.submitted_roster ?? [] };
}

export async function respondToApprovalReview(id: string, captainId: string, response: string): Promise<ApprovalReview> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT review.*, registration.status AS registration_status, registration.team_id,
              registration.version, registration.submitted_roster, team.captain_id
       FROM team_registration_approval_reviews review
       JOIN team_registrations registration ON registration.id=review.registration_id
       JOIN teams team ON team.id=registration.team_id WHERE review.id=$1 FOR UPDATE OF review, registration`, [id],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "Approval review not found", "APPROVAL_REVIEW_NOT_FOUND");
    if (row.captain_id !== captainId) throw new AppError(403, "You cannot respond to this team review", "FORBIDDEN");
    if (row.registration_status !== "APPROVED") throw new AppError(409, "Đội không còn ở trạng thái đã duyệt", "REGISTRATION_NOT_APPROVED");
    if (!['OPEN','SUPPLEMENT_REQUIRED'].includes(row.status)) throw new AppError(409, "Yêu cầu xem xét lại không còn chờ phản hồi", "APPROVAL_REVIEW_NOT_OPEN");
    if (new Date(row.supplement_deadline ?? row.response_deadline).getTime() < Date.now()) throw new AppError(409, "Đã quá hạn phản hồi yêu cầu xem xét lại", "APPROVAL_REVIEW_DEADLINE_EXPIRED");
    const updated = await client.query(
      `UPDATE team_registration_approval_reviews SET status='RESPONDED',team_response=$2,responded_at=NOW(),decided_by=NULL,decided_at=NULL,updated_at=NOW()
       WHERE id=$1 RETURNING *`, [id, response.trim()],
    );
    await client.query(
      `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
       VALUES($1,$2,'APPROVAL_REVIEW_RESPONSE',$3::jsonb,$4,$5)`,
      [row.registration_id, row.version, JSON.stringify(row.submitted_roster ?? []), response.trim(), captainId],
    );
    await insertReviewEvent(client, { reviewId: id, registrationId: row.registration_id,
      eventType: "TEAM_RESPONDED", statusBefore: row.status, statusAfter: "RESPONDED", actorId: captainId,
      note: response.trim(), rosterSnapshot: row.submitted_roster ?? [] });
    await client.query("COMMIT");
    return mapReview(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function retainApprovalReview(id: string, decidedBy: string, note: string): Promise<ApprovalReview> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT review.*, registration.version, registration.submitted_roster
       FROM team_registration_approval_reviews review
       JOIN team_registrations registration ON registration.id=review.registration_id
       WHERE review.id=$1 AND registration.status='APPROVED' FOR UPDATE OF review, registration`, [id],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(404, "Approval review not found or registration is no longer approved", "APPROVAL_REVIEW_NOT_FOUND");
    if (!["OPEN", "RESPONDED", "SUPPLEMENT_REQUIRED"].includes(row.status)) throw new AppError(409, "Approval review has already been resolved", "APPROVAL_REVIEW_ALREADY_DECIDED");
    const updated = await client.query(
      `UPDATE team_registration_approval_reviews SET status='RETAINED',decision_note=NULLIF(BTRIM($2),''),
       decided_by=$3,decided_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`, [id, note, decidedBy],
    );
    await client.query(
      `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
       VALUES($1,$2,'APPROVAL_REVIEW_RETAINED',$3::jsonb,$4,$5)`,
      [row.registration_id, row.version, JSON.stringify(row.submitted_roster ?? []), note.trim() || "BTC giữ nguyên quyết định duyệt", decidedBy],
    );
    await insertReviewEvent(client, { reviewId: id, registrationId: row.registration_id,
      eventType: "RETAINED", statusBefore: row.status, statusAfter: "RETAINED", actorId: decidedBy,
      note: note.trim() || "BTC giữ nguyên quyết định duyệt", rosterSnapshot: row.submitted_roster ?? [] });
    await client.query("COMMIT");
    return mapReview(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function markApprovalReviewRevoked(client: import("pg").PoolClient, reviewId: string, note: string, actorId: string): Promise<void> {
  const review = await client.query(
    `SELECT review.registration_id,review.status AS review_status,registration.version,registration.submitted_roster
     FROM team_registration_approval_reviews review JOIN team_registrations registration ON registration.id=review.registration_id
     WHERE review.id=$1 AND review.status IN ('OPEN','RESPONDED','SUPPLEMENT_REQUIRED') AND registration.status='APPROVAL_REVOKED' FOR UPDATE OF review,registration`, [reviewId],
  );
  if (!review.rowCount) throw new AppError(409, "Approval review changed before revocation was recorded", "APPROVAL_REVIEW_DECISION_CONFLICT");
  await client.query(
    `UPDATE team_registration_approval_reviews SET status='REVOKED',decision_note=$2,decided_by=$3,decided_at=NOW(),updated_at=NOW() WHERE id=$1`,
    [reviewId,note.trim(),actorId],
  );
  await insertReviewEvent(client, { reviewId, registrationId: review.rows[0].registration_id,
    eventType: "REVOKED", statusBefore: review.rows[0].review_status, statusAfter: "REVOKED", actorId,
    note: note.trim(), rosterSnapshot: review.rows[0].submitted_roster ?? [] });
}

export async function requestApprovalReviewSupplement(id: string, note: string, deadline: string, decidedBy: string): Promise<ApprovalReview> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT review.*,registration.version,registration.submitted_roster
       FROM team_registration_approval_reviews review JOIN team_registrations registration ON registration.id=review.registration_id
       WHERE review.id=$1 AND registration.status='APPROVED' AND review.status IN ('OPEN','RESPONDED')
       FOR UPDATE OF review,registration`, [id],
    );
    const row = result.rows[0];
    if (!row) throw new AppError(409, "Yêu cầu xem xét lại không còn mở", "APPROVAL_REVIEW_NOT_OPEN");
    const updated = await client.query(
      `UPDATE team_registration_approval_reviews
       SET status='SUPPLEMENT_REQUIRED',decision_note=$2,supplement_deadline=$3,
           decided_by=NULL,decided_at=NULL,team_response=NULL,responded_at=NULL,updated_at=NOW()
       WHERE id=$1 RETURNING *`, [id,note.trim(),deadline],
    );
    await client.query(
      `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
       VALUES($1,$2,'APPROVAL_REVIEW_OPENED',$3::jsonb,$4,$5)`,
      [row.registration_id,row.version,JSON.stringify(row.submitted_roster ?? []),`Yêu cầu bổ sung: ${note.trim()}\nHạn: ${deadline}`,decidedBy],
    );
    await insertReviewEvent(client, { reviewId: id, registrationId: row.registration_id,
      eventType: "SUPPLEMENT_REQUESTED", statusBefore: row.status, statusAfter: "SUPPLEMENT_REQUIRED", actorId: decidedBy,
      note: note.trim(), rosterSnapshot: row.submitted_roster ?? [] });
    await client.query("COMMIT");
    return mapReview(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

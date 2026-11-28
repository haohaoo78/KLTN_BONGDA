import type {
  Card,
  CardCreateInput,
  Suspension,
  SuspensionCreateInput,
  Complaint,
  ComplaintCreateInput,
  ComplaintUpdateInput,
  DisciplinaryDecision,
  DisciplinaryDecisionCreateInput,
  ComplaintAppeal,
  ComplaintAppealCreateInput,
  ComplaintAppealReviewInput,
} from "../models/discipline";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";

// Cards
function mapCard(row: {
  event_kind?: string | null;
  event_phase?: string | null;
  id: string;
  player_id: string;
  match_id: string;
  tournament_id: string;
  team_id: string;
  card_type: string;
  minute: number | null;
  reason: string | null;
  issued_by: string;
  issued_at: string;
}): Card {
  return {
    eventKind:row.event_kind??null,
    phase:row.event_phase??null,
    id: row.id,
    playerId: row.player_id,
    matchId: row.match_id,
    tournamentId: row.tournament_id,
    teamId: row.team_id,
    cardType: row.card_type as any,
    minute: row.minute,
    reason: row.reason,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
  };
}

export async function listCards(
  tournamentId: string,
  playerId?: string,
  teamId?: string,
): Promise<Card[]> {
  const pool = getPool();
  let query = `
    SELECT id, player_id, match_id, tournament_id, team_id, card_type, minute, reason, issued_by, issued_at, event_kind, event_phase
    FROM cards
    WHERE tournament_id = $1 AND voided_at IS NULL
  `;
  const params: unknown[] = [tournamentId];
  let idx = 2;

  if (playerId) {
    query += ` AND player_id = $${idx++}`;
    params.push(playerId);
  }
  if (teamId) {
    query += ` AND team_id = $${idx++}`;
    params.push(teamId);
  }

  query += ` ORDER BY issued_at DESC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapCard);
}

export async function createCard(input: CardCreateInput, issuedBy: string): Promise<Card> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO cards (player_id, match_id, tournament_id, team_id, card_type, minute, reason, issued_by, source_event_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (source_event_id) DO UPDATE SET source_event_id = EXCLUDED.source_event_id
     RETURNING id, player_id, match_id, tournament_id, team_id, card_type, minute, reason, issued_by, issued_at`,
    [
      input.playerId,
      input.matchId,
      input.tournamentId,
      input.teamId,
      input.cardType,
      input.minute ?? null,
      input.reason ?? null,
      issuedBy,
      input.sourceEventId ?? null,
    ],
  );

  return mapCard(result.rows[0]);
}

export async function countUnsuspendedYellowCards(playerId: string, tournamentId: string): Promise<number> {
  const result = await getPool().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM cards card
     WHERE card.player_id = $1 AND card.tournament_id = $2
       AND card.card_type = 'YELLOW' AND card.voided_at IS NULL
       AND card.issued_at > COALESCE((
         SELECT MAX(suspension.issued_at)
         FROM suspensions suspension
         WHERE suspension.player_id = $1 AND suspension.tournament_id = $2
           AND suspension.type = 'YELLOW_CARDS'
           AND (suspension.source_card_id IS NULL OR EXISTS (
             SELECT 1 FROM cards source_card
             WHERE source_card.id = suspension.source_card_id AND source_card.voided_at IS NULL
           ))
       ), '-infinity'::timestamptz)`,
    [playerId, tournamentId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

// Suspensions
function mapSuspension(row: {
  projection_key?: string | null;
  scope_stage?: string | null;
  status_reason?: string | null;
  served_match_ids?: string[];
  id: string;
  player_id: string;
  tournament_id: string;
  team_id: string;
  type: string;
  start_date: string;
  end_date: string | null;
  reason: string | null;
  match_id: string | null;
  issued_by: string;
  issued_at: string;
  is_active: boolean;
  matches_suspended: number | null;
}): Suspension {
  return {
    projectionKey: row.projection_key ?? null,
    scopeStage: row.scope_stage ?? null,
    statusReason: row.status_reason ?? null,
    servedMatchIds: row.served_match_ids ?? [],
    id: row.id,
    playerId: row.player_id,
    tournamentId: row.tournament_id,
    teamId: row.team_id,
    type: row.type as any,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    matchId: row.match_id,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    isActive: row.is_active,
    matchesSuspended: row.matches_suspended,
  };
}

export async function listSuspensions(
  tournamentId: string,
  playerId?: string,
  isActive?: boolean,
): Promise<Suspension[]> {
  const pool = getPool();
  let query = `
    SELECT id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active, matches_suspended, scope_stage, status_reason, served_match_ids, projection_key
    FROM suspensions
    WHERE tournament_id = $1
  `;
  const params: unknown[] = [tournamentId];
  let idx = 2;

  if (playerId) {
    query += ` AND player_id = $${idx++}`;
    params.push(playerId);
  }
  if (isActive !== undefined) {
    query += ` AND is_active = $${idx++}`;
    params.push(isActive);
  }

  query += ` ORDER BY start_date DESC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapSuspension);
}

export async function findSuspensionById(id: string): Promise<Suspension | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active, matches_suspended, scope_stage, status_reason, served_match_ids, projection_key
     FROM suspensions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapSuspension(result.rows[0]) : null;
}

export async function createSuspension(input: SuspensionCreateInput, issuedBy: string): Promise<Suspension> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO suspensions (player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, source_card_id, matches_suspended)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (source_card_id) DO UPDATE SET source_card_id = EXCLUDED.source_card_id
     RETURNING id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active, matches_suspended, scope_stage, status_reason, served_match_ids, projection_key`,
    [
      input.playerId,
      input.tournamentId,
      input.teamId,
      input.type,
      input.startDate,
      input.matchesSuspended!=null?null:input.endDate,
      input.reason ?? null,
      input.matchId ?? null,
      issuedBy,
      input.sourceCardId ?? null,
      input.matchesSuspended ?? null,
    ],
  );

  return mapSuspension(result.rows[0]);
}

export async function voidCardBySourceEventId(eventId: string, actorId: string, reason: string): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const card = await client.query<{ id: string }>(
      `UPDATE cards SET voided_at = NOW(), voided_by = $2, void_reason = $3
       WHERE source_event_id = $1 AND voided_at IS NULL
       RETURNING id`,
      [eventId, actorId, reason],
    );
    if (card.rowCount) {
      await client.query(
        `UPDATE suspensions SET is_active = FALSE, end_date = NOW()
         WHERE source_card_id = $1 AND is_active = TRUE`,
        [card.rows[0].id],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSuspension(id: string, isActive: boolean): Promise<Suspension | null> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE suspensions SET is_active = $1, manually_lifted = ($1 = false), status_reason = CASE WHEN $1 = false THEN 'MANUALLY_LIFTED' ELSE status_reason END, end_date = CASE WHEN $1 = false AND matches_suspended IS NULL THEN NOW() ELSE end_date END
     WHERE id = $2
     RETURNING id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active, matches_suspended, scope_stage, status_reason, served_match_ids, projection_key`,
    [isActive, id],
  );

  if (result.rowCount === 0) return null;
  return mapSuspension(result.rows[0]);
}

// Complaints
function mapComplaint(row: {
  id: string;
  match_id: string;
  tournament_id: string;
  team_id: string;
  submitted_by: string;
  complaint_type: string;
  description: string;
  evidence: string | null;
  status: string;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  decision: string | null;
  decision_reason: string | null;
}): Complaint {
  return {
    id: row.id,
    matchId: row.match_id,
    tournamentId: row.tournament_id,
    teamId: row.team_id,
    submittedBy: row.submitted_by,
    complaintType: row.complaint_type,
    description: row.description,
    evidence: row.evidence,
    status: row.status as any,
    submittedAt: row.submitted_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    decision: row.decision,
    decisionReason: row.decision_reason,
  };
}

export async function listComplaints(
  tournamentId: string,
  status?: string,
  teamId?: string,
): Promise<Complaint[]> {
  const pool = getPool();
  let query = `
    SELECT id, match_id, tournament_id, team_id, submitted_by, complaint_type, description, evidence, status, submitted_at, reviewed_by, reviewed_at, decision, decision_reason
    FROM complaints
    WHERE tournament_id = $1
  `;
  const params: unknown[] = [tournamentId];
  let idx = 2;

  if (status) {
    query += ` AND status = $${idx++}`;
    params.push(status);
  }
  if (teamId) {
    query += ` AND team_id = $${idx++}`;
    params.push(teamId);
  }

  query += ` ORDER BY submitted_at DESC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapComplaint);
}

export async function findComplaintById(id: string): Promise<Complaint | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, match_id, tournament_id, team_id, submitted_by, complaint_type, description, evidence, status, submitted_at, reviewed_by, reviewed_at, decision, decision_reason
     FROM complaints WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapComplaint(result.rows[0]) : null;
}

export async function createComplaint(input: ComplaintCreateInput): Promise<Complaint> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO complaints (match_id, tournament_id, team_id, submitted_by, complaint_type, description, evidence,deadline_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7,$8::jsonb)
     RETURNING id, match_id, tournament_id, team_id, submitted_by, complaint_type, description, evidence, status, submitted_at, reviewed_by, reviewed_at, decision, decision_reason`,
    [
      input.matchId,
      input.tournamentId,
      input.teamId,
      input.submittedBy,
      input.complaintType,
      input.description,
      input.evidence ?? null,
      JSON.stringify(input.deadlineSnapshot??null),
    ],
  );

  return mapComplaint(result.rows[0]);
}

export async function updateComplaint(id: string, input: ComplaintUpdateInput, reviewedBy?: string): Promise<Complaint | null> {
 const c=await getPool().connect();try{await c.query('BEGIN');const before=(await c.query('SELECT * FROM complaints WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!before){await c.query('ROLLBACK');return null;}
 if(!['PENDING','UNDER_REVIEW'].includes(before.status))throw new AppError(409,'Complaint has already been decided','COMPLAINT_ALREADY_DECIDED');
 const after=(await c.query('UPDATE complaints SET status=$2,decision=$3,decision_reason=$4,reviewed_by=$5,reviewed_at=NOW() WHERE id=$1 RETURNING *',[id,input.status,input.decision??null,input.decisionReason??null,reviewedBy])).rows[0];
 await c.query('INSERT INTO complaint_review_history(complaint_id,actor_id,before_snapshot,after_snapshot) VALUES($1,$2,$3::jsonb,$4::jsonb)',[id,reviewedBy,JSON.stringify(before),JSON.stringify(after)]);
 await c.query('COMMIT');return mapComplaint(after);
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

type ComplaintAppealRow = {
  id: string; complaint_id: string; submitted_by: string; description: string; evidence: string | null;
  status: string; submitted_at: string; reviewed_by: string | null; reviewed_at: string | null; decision_reason: string | null;
  original_decision: ComplaintAppeal["originalDecision"];
};

function mapComplaintAppeal(row: ComplaintAppealRow): ComplaintAppeal {
  return {
    id: row.id, complaintId: row.complaint_id, submittedBy: row.submitted_by,
    description: row.description, evidence: row.evidence, status: row.status as ComplaintAppeal["status"],
    submittedAt: row.submitted_at, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at,
    decisionReason: row.decision_reason, originalDecision: row.original_decision,
  };
}

const complaintAppealColumns = `id, complaint_id, submitted_by, description, evidence, status,
  submitted_at, reviewed_by, reviewed_at, decision_reason, original_decision`;

export async function findComplaintAppeal(id: string): Promise<ComplaintAppeal | null> {
  const result = await getPool().query<ComplaintAppealRow>(
    `SELECT ${complaintAppealColumns} FROM complaint_appeals WHERE id = $1`, [id],
  );
  return result.rows[0] ? mapComplaintAppeal(result.rows[0]) : null;
}

export async function findComplaintAppealByComplaintId(complaintId: string): Promise<ComplaintAppeal | null> {
  const result = await getPool().query<ComplaintAppealRow>(
    `SELECT ${complaintAppealColumns} FROM complaint_appeals WHERE complaint_id = $1`, [complaintId],
  );
  return result.rows[0] ? mapComplaintAppeal(result.rows[0]) : null;
}

export async function listComplaintAppeals(tournamentId: string, status?: string): Promise<ComplaintAppeal[]> {
  const values: unknown[] = [tournamentId];
  let query = `SELECT appeal.id, appeal.complaint_id, appeal.submitted_by, appeal.description, appeal.evidence,
    appeal.status, appeal.submitted_at, appeal.reviewed_by, appeal.reviewed_at, appeal.decision_reason, appeal.original_decision
    FROM complaint_appeals appeal
    JOIN complaints complaint ON complaint.id = appeal.complaint_id
    WHERE complaint.tournament_id = $1`;
  if (status) { values.push(status); query += ` AND appeal.status = $2`; }
  query += ` ORDER BY appeal.submitted_at DESC`;
  const result = await getPool().query<ComplaintAppealRow>(query, values);
  return result.rows.map(mapComplaintAppeal);
}

export async function createComplaintAppeal(input: ComplaintAppealCreateInput): Promise<ComplaintAppeal> {
  const result = await getPool().query<ComplaintAppealRow>(
    `INSERT INTO complaint_appeals (complaint_id, submitted_by, description, evidence,deadline_snapshot)
     VALUES ($1, $2, $3, $4,$5::jsonb) RETURNING ${complaintAppealColumns}`,
    [input.complaintId, input.submittedBy, input.description.trim(), input.evidence ?? null,JSON.stringify(input.deadlineSnapshot??null)],
  );
  return mapComplaintAppeal(result.rows[0]);
}

export async function updateComplaintAppeal(
  id: string, input: ComplaintAppealReviewInput, reviewedBy: string,
): Promise<ComplaintAppeal | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<ComplaintAppealRow & { tournament_id: string; team_id: string; complaint_status: string }>(
      `SELECT appeal.id, appeal.complaint_id, appeal.submitted_by, appeal.description, appeal.evidence,
        appeal.status, appeal.submitted_at, appeal.reviewed_by, appeal.reviewed_at, appeal.decision_reason, appeal.original_decision,
        complaint.tournament_id, complaint.team_id, complaint.status AS complaint_status
       FROM complaint_appeals appeal JOIN complaints complaint ON complaint.id = appeal.complaint_id
       WHERE appeal.id = $1 FOR UPDATE OF appeal, complaint`, [id],
    );
    if (!current.rows[0] || current.rows[0].status !== "PENDING") {
      await client.query("ROLLBACK");
      return null;
    }
    const row = current.rows[0];
    let originalDecision: Record<string, unknown> | null = null;
    if (input.status === "APPROVED") {
      if (!["APPROVED", "REJECTED", "CLOSED"].includes(row.complaint_status)) {
        await client.query("ROLLBACK");
        return null;
      }
      const original = await client.query(
        `SELECT status, reviewed_by, reviewed_at, decision, decision_reason FROM complaints WHERE id = $1`,
        [row.complaint_id],
      );
      originalDecision = original.rows[0] ?? null;
      const originalComplaint=(await client.query('SELECT * FROM complaints WHERE id=$1',[row.complaint_id])).rows[0];
      if(originalComplaint)await client.query('INSERT INTO complaint_review_history(complaint_id,appeal_id,actor_id,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[row.complaint_id,id,reviewedBy,JSON.stringify(originalComplaint),JSON.stringify({...originalComplaint,status:'UNDER_REVIEW',reviewed_by:null,reviewed_at:null,decision:null,decision_reason:null})]);
    }
    const updated = await client.query<ComplaintAppealRow>(
      `UPDATE complaint_appeals SET status = $2, decision_reason = $3, reviewed_by = $4,
        reviewed_at = NOW(), original_decision = $5::jsonb
       WHERE id = $1 AND status = 'PENDING' RETURNING ${complaintAppealColumns}`,
      [id, input.status, input.decisionReason.trim(), reviewedBy, originalDecision ? JSON.stringify(originalDecision) : null],
    );
    if (input.status === "APPROVED") {
      await client.query(
        `UPDATE complaints SET status = 'UNDER_REVIEW', reviewed_by = NULL, reviewed_at = NULL,
          decision = NULL, decision_reason = NULL WHERE id = $1`, [row.complaint_id],
      );
    }
    await client.query('INSERT INTO complaint_review_history(complaint_id,appeal_id,actor_id,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[row.complaint_id,id,reviewedBy,JSON.stringify(row),JSON.stringify(updated.rows[0])]);
    await client.query("COMMIT");
    return updated.rows[0] ? mapComplaintAppeal(updated.rows[0]) : null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

// Disciplinary Decisions
function mapDisciplinaryDecision(row: {
  id: string;
  complaint_id: string | null;
  player_id: string | null;
  action: string;
  additional_matches_suspended: number | null;
  start_date: string | null;
  end_date: string | null;
  issued_by: string;
  issued_at: string;
  notes: string | null;
  suspension_id: string | null;
}): DisciplinaryDecision {
  return {
    id: row.id,
    complaintId: row.complaint_id,
    playerId: row.player_id,
    action: row.action,
    additionalMatchesSuspended: row.additional_matches_suspended,
    startDate: row.start_date,
    endDate: row.end_date,
    issuedBy: row.issued_by,
    issuedAt: row.issued_at,
    notes: row.notes,
    suspensionId: row.suspension_id,
  };
}

export async function createDisciplinaryDecision(
  input: DisciplinaryDecisionCreateInput,
  issuedBy: string,
  suspension?: SuspensionCreateInput,
): Promise<DisciplinaryDecision> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO disciplinary_decisions (complaint_id, player_id, action, additional_matches_suspended, start_date, end_date, issued_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, complaint_id, player_id, action, additional_matches_suspended, start_date, end_date, issued_by, issued_at, notes, suspension_id`,
      [
        input.complaintId ?? null,
        input.playerId ?? null,
        input.action,
        input.additionalMatchesSuspended ?? null,
        input.startDate ?? null,
        input.endDate ?? null,
        issuedBy,
        input.notes ?? null,
      ],
    );
    let suspensionId: string | null = null;
    if (suspension) {
      const createdSuspension = await client.query<{ id: string }>(
        `INSERT INTO suspensions (player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, source_card_id, matches_suspended)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          suspension.playerId,
          suspension.tournamentId,
          suspension.teamId,
          suspension.type,
          suspension.startDate,
          suspension.endDate,
          suspension.reason ?? null,
          suspension.matchId ?? null,
          issuedBy,
          suspension.sourceCardId ?? null,
          suspension.matchesSuspended ?? null,
        ],
      );
      suspensionId = createdSuspension.rows[0].id;
      await client.query("UPDATE disciplinary_decisions SET suspension_id = $2 WHERE id = $1", [result.rows[0].id, suspensionId]);
    }
    await client.query("COMMIT");
    return mapDisciplinaryDecision({ ...result.rows[0], suspension_id: suspensionId });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function listDisciplinaryDecisions(tournamentId: string, playerId?: string): Promise<DisciplinaryDecision[]> {
  const pool = getPool();
  let query = `
    SELECT d.id, d.complaint_id, d.player_id, d.action, d.additional_matches_suspended, d.start_date, d.end_date, d.issued_by, d.issued_at, d.notes, d.suspension_id
    FROM disciplinary_decisions d
    JOIN complaints c ON c.id = d.complaint_id
    WHERE c.tournament_id = $1
  `;
  const params: unknown[] = [tournamentId];

  if (playerId) {
    query += ` AND d.player_id = $2`;
    params.push(playerId);
  }

  query += ` ORDER BY d.issued_at DESC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapDisciplinaryDecision);
}

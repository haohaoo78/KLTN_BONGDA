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
} from "../models/discipline";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";

// Cards
function mapCard(row: {
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
    SELECT id, player_id, match_id, tournament_id, team_id, card_type, minute, reason, issued_by, issued_at
    FROM cards
    WHERE tournament_id = $1
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
    `INSERT INTO cards (player_id, match_id, tournament_id, team_id, card_type, minute, reason, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
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
    ],
  );

  return mapCard(result.rows[0]);
}

// Suspensions
function mapSuspension(row: {
  id: string;
  player_id: string;
  tournament_id: string;
  team_id: string;
  type: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  match_id: string | null;
  issued_by: string;
  issued_at: string;
  is_active: boolean;
}): Suspension {
  return {
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
  };
}

export async function listSuspensions(
  tournamentId: string,
  playerId?: string,
  isActive?: boolean,
): Promise<Suspension[]> {
  const pool = getPool();
  let query = `
    SELECT id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active
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
    `SELECT id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active
     FROM suspensions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? mapSuspension(result.rows[0]) : null;
}

export async function createSuspension(input: SuspensionCreateInput, issuedBy: string): Promise<Suspension> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO suspensions (player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active`,
    [
      input.playerId,
      input.tournamentId,
      input.teamId,
      input.type,
      input.startDate,
      input.endDate,
      input.reason ?? null,
      input.matchId ?? null,
      issuedBy,
    ],
  );

  return mapSuspension(result.rows[0]);
}

export async function updateSuspension(id: string, isActive: boolean): Promise<Suspension | null> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE suspensions SET is_active = $1, end_date = CASE WHEN $1 = false THEN NOW() ELSE end_date END
     WHERE id = $2
     RETURNING id, player_id, tournament_id, team_id, type, start_date, end_date, reason, match_id, issued_by, issued_at, is_active`,
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
    `INSERT INTO complaints (match_id, tournament_id, team_id, submitted_by, complaint_type, description, evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, match_id, tournament_id, team_id, submitted_by, complaint_type, description, evidence, status, submitted_at, reviewed_by, reviewed_at, decision, decision_reason`,
    [
      input.matchId,
      input.tournamentId,
      input.teamId,
      input.submittedBy,
      input.complaintType,
      input.description,
      input.evidence ?? null,
    ],
  );

  return mapComplaint(result.rows[0]);
}

export async function updateComplaint(id: string, input: ComplaintUpdateInput, reviewedBy?: string): Promise<Complaint | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.decision !== undefined) {
    sets.push(`decision = $${idx++}`);
    values.push(input.decision);
  }
  if (input.decisionReason !== undefined) {
    sets.push(`decision_reason = $${idx++}`);
    values.push(input.decisionReason);
  }

  if (reviewedBy) {
    sets.push(`reviewed_by = $${idx++}`);
    values.push(reviewedBy);
    sets.push(`reviewed_at = NOW()`);
  }

  if (sets.length === 0) {
    return null;
  }

  values.push(id);

  await pool.query(
    `UPDATE complaints SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  const result = await pool.query(
    `SELECT id, match_id, tournament_id, team_id, submitted_by, complaint_type, description, evidence, status, submitted_at, reviewed_by, reviewed_at, decision, decision_reason
     FROM complaints WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapComplaint(result.rows[0]);
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
  };
}

export async function createDisciplinaryDecision(input: DisciplinaryDecisionCreateInput, issuedBy: string): Promise<DisciplinaryDecision> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO disciplinary_decisions (complaint_id, player_id, action, additional_matches_suspended, start_date, end_date, issued_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, complaint_id, player_id, action, additional_matches_suspended, start_date, end_date, issued_by, issued_at, notes`,
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

  return mapDisciplinaryDecision(result.rows[0]);
}

export async function listDisciplinaryDecisions(playerId?: string): Promise<DisciplinaryDecision[]> {
  const pool = getPool();
  let query = `
    SELECT id, complaint_id, player_id, action, additional_matches_suspended, start_date, end_date, issued_by, issued_at, notes
    FROM disciplinary_decisions
  `;
  const params: unknown[] = [];

  if (playerId) {
    query += ` WHERE player_id = $1`;
    params.push(playerId);
  }

  query += ` ORDER BY issued_at DESC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapDisciplinaryDecision);
}

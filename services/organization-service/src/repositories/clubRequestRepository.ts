import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import type { ClubRequest, ClubRequestStatus } from "../models/team";

type ClubRequestRow = {
  id: string;
  applicant_id: string;
  institution_id: string;
  captain_name: string;
  name: string;
  short_name: string | null;
  description: string | null;
  logo_url: string | null;
  unit_name: string | null;
  contact_email: string;
  contact_phone: string;
  initial_members: Array<Record<string, unknown>>;
  status: ClubRequestStatus;
  decision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  approved_team_id: string | null;
  created_at: Date;
};

const clubRequestSelect = `
  SELECT id, applicant_id, institution_id, captain_name, name, short_name, description, logo_url,
         unit_name, contact_email, contact_phone, initial_members, status,
         decision_note, reviewed_by, reviewed_at, approved_team_id, created_at
  FROM club_requests
`;

function mapClubRequest(row: ClubRequestRow): ClubRequest {
  return {
    id: row.id,
    applicantId: row.applicant_id,
    institutionId: row.institution_id,
    captainName: row.captain_name,
    name: row.name,
    shortName: row.short_name,
    description: row.description,
    logoUrl: row.logo_url,
    unitName: row.unit_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    initialMembers: row.initial_members,
    status: row.status,
    decisionNote: row.decision_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    approvedTeamId: row.approved_team_id,
    createdAt: row.created_at.toISOString(),
  };
}

export type CreateClubRequestInput = {
  applicantId: string;
  institutionId: string;
  captainName: string;
  name: string;
  shortName?: string;
  description?: string;
  logoUrl?: string;
  unitName?: string;
  contactEmail: string;
  contactPhone: string;
  initialMembers: Array<Record<string, unknown>>;
};

export async function createClubRequest(input: CreateClubRequestInput): Promise<ClubRequest> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const institution = await client.query(
      "SELECT id FROM institutions WHERE id = $1 AND is_active = TRUE FOR UPDATE",
      [input.institutionId],
    );
    if (!institution.rowCount) {
      throw new AppError(409, "The assigned school is no longer active", "INSTITUTION_UNAVAILABLE");
    }

    const existingTeam = await client.query(
      `SELECT 1 FROM teams
       WHERE institution_id = $1 AND LOWER(name) = LOWER($2)`,
      [input.institutionId, input.name],
    );
    if (existingTeam.rowCount) {
      throw new AppError(409, "A club with this name already exists at the school", "CLUB_NAME_EXISTS");
    }

    const result = await client.query<ClubRequestRow>(
      `INSERT INTO club_requests
         (applicant_id, institution_id, captain_name, name, short_name, description, logo_url,
          unit_name, contact_email, contact_phone, initial_members)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING id, applicant_id, institution_id, captain_name, name, short_name, description,
                 logo_url, unit_name, contact_email, contact_phone, initial_members,
                 status, decision_note, reviewed_by, reviewed_at, approved_team_id, created_at`,
      [
        input.applicantId,
        input.institutionId,
        input.captainName,
        input.name,
        input.shortName ?? null,
        input.description ?? null,
        input.logoUrl ?? null,
        input.unitName ?? null,
        input.contactEmail,
        input.contactPhone,
        JSON.stringify(input.initialMembers),
      ],
    );
    await client.query("COMMIT");
    return mapClubRequest(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "A pending request for this school and club name already exists", "CLUB_REQUEST_PENDING");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listClubRequests(input: {
  applicantId?: string;
  institutionId?: string;
  status?: ClubRequestStatus;
  search?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
}): Promise<{ requests: ClubRequest[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (input.applicantId) {
    values.push(input.applicantId);
    conditions.push(`applicant_id = $${values.length}`);
  }
  if (input.institutionId) {
    values.push(input.institutionId);
    conditions.push(`institution_id = $${values.length}`);
  }
  if (input.status) {
    values.push(input.status);
    conditions.push(`status = $${values.length}`);
  }
  if (input.search) {
    values.push(`%${input.search}%`);
    conditions.push(`(name ILIKE $${values.length} OR short_name ILIKE $${values.length} OR captain_name ILIKE $${values.length} OR contact_email ILIKE $${values.length})`);
  }
  if (input.createdFrom) {
    values.push(input.createdFrom);
    conditions.push(`created_at >= $${values.length}::date`);
  }
  if (input.createdTo) {
    values.push(input.createdTo);
    conditions.push(`created_at < ($${values.length}::date + INTERVAL '1 day')`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const count = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM club_requests ${where}`,
    values,
  );
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const offset = Math.max(input.offset ?? 0, 0);
  const pageValues = [...values, limit, offset];
  const result = await pool.query<ClubRequestRow>(
    `${clubRequestSelect} ${where} ORDER BY created_at DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return {
    requests: result.rows.map(mapClubRequest),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

export async function reviewClubRequest(input: {
  requestId: string;
  reviewerId: string;
  reviewerInstitutionId?: string;
  isAdmin: boolean;
  decision: Exclude<ClubRequestStatus, "PENDING">;
  decisionNote: string | null;
}): Promise<ClubRequest> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!input.isAdmin && !input.reviewerInstitutionId) {
      throw new AppError(403, "BTC must have an active school assignment", "SCHOOL_ASSIGNMENT_REQUIRED");
    }
    const current = await client.query<ClubRequestRow>(
      `${clubRequestSelect} WHERE id = $1 FOR UPDATE`,
      [input.requestId],
    );
    if (!current.rowCount) {
      throw new AppError(404, "Club request not found", "CLUB_REQUEST_NOT_FOUND");
    }
    const request = current.rows[0];
    if (!input.isAdmin && request.institution_id !== input.reviewerInstitutionId) {
      throw new AppError(403, "You cannot review a club request from another school", "FORBIDDEN");
    }
    if (request.status !== "PENDING") {
      throw new AppError(409, "Club request has already been reviewed", "CLUB_REQUEST_ALREADY_REVIEWED");
    }

    let approvedTeamId: string | null = null;
    if (input.decision === "APPROVED") {
      const activeInstitution = await client.query(
        "SELECT id FROM institutions WHERE id = $1 AND is_active = TRUE FOR UPDATE",
        [request.institution_id],
      );
      if (!activeInstitution.rowCount) {
        throw new AppError(409, "The school is no longer active", "INSTITUTION_UNAVAILABLE");
      }
      const duplicate = await client.query(
        `SELECT 1 FROM teams
         WHERE institution_id = $1 AND LOWER(name) = LOWER($2)`,
        [request.institution_id, request.name],
      );
      if (duplicate.rowCount) {
        throw new AppError(409, "A club with this name already exists at the school", "CLUB_NAME_EXISTS");
      }
      const team = await client.query<{ id: string }>(
        `INSERT INTO teams
           (name, short_name, description, logo_url, institution_id, unit_name,
            representative_name, captain_id, contact_email, contact_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          request.name,
          request.short_name,
          request.description,
          request.logo_url,
          request.institution_id,
          request.unit_name,
          request.captain_name,
          request.applicant_id,
          request.contact_email,
          request.contact_phone,
        ],
      );
      approvedTeamId = team.rows[0].id;
    }

    const updated = await client.query<ClubRequestRow>(
      `UPDATE club_requests
       SET status = $2, decision_note = $3, reviewed_by = $4,
           reviewed_at = NOW(), approved_team_id = $5
       WHERE id = $1
       RETURNING id, applicant_id, institution_id, captain_name, name, short_name, description,
                 logo_url, unit_name, contact_email, contact_phone, initial_members,
                 status, decision_note, reviewed_by, reviewed_at, approved_team_id, created_at`,
      [
        input.requestId,
        input.decision,
        input.decisionNote,
        input.reviewerId,
        approvedTeamId,
      ],
    );
    await client.query("COMMIT");
    return mapClubRequest(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

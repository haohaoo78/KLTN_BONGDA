import type {
  Institution,
  InstitutionCreateInput,
  InstitutionUpdateInput,
  Roster,
  RosterCreateInput,
  PlayerRequest,
  PlayerRequestCreateInput,
} from "../models/team";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

function mapInstitution(row: {
  id: string;
  name: string;
  short_name: string | null;
  code: string | null;
  admission_code: string | null;
  institution_type: "UNIVERSITY" | "COLLEGE" | "OTHER";
  address: string | null;
  official_website: string | null;
  city: string | null;
  data_source_url: string | null;
  data_collected_at: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: "DRAFT" | "ACTIVE" | "SUSPENDED";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): Institution {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    code: row.code,
    admissionCode: row.admission_code,
    institutionType: row.institution_type,
    address: row.address,
    officialWebsite: row.official_website,
    city: row.city,
    dataSourceUrl: row.data_source_url,
    dataCollectedAt: row.data_collected_at,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    status: row.status,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listInstitutions(filters: {
  isActive?: boolean;
  institutionType?: Institution["institutionType"];
  status?: Institution["status"];
  search?: string;
  city?: string;
} = {}): Promise<Institution[]> {
  const pool = getPool();
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.isActive !== undefined) {
    params.push(filters.isActive);
    conditions.push(`is_active = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.institutionType) {
    params.push(filters.institutionType);
    conditions.push(`institution_type = $${params.length}`);
  }
  if (filters.city) {
    params.push(filters.city);
    conditions.push(`city = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(name ILIKE $${params.length} OR short_name ILIKE $${params.length} OR code ILIKE $${params.length} OR admission_code ILIKE $${params.length})`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const query = `SELECT id, name, short_name, code, admission_code, institution_type, address,
                        official_website, city, data_source_url, data_collected_at,
                        contact_email, contact_phone, status, is_active, created_at, updated_at
                 FROM institutions ${where} ORDER BY name ASC`;
  const result = await pool.query(query, params);
  return result.rows.map(mapInstitution);
}

export async function findInstitutionById(id: string): Promise<Institution | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, name, short_name, code, admission_code, institution_type, address,
            official_website, city, data_source_url, data_collected_at,
            contact_email, contact_phone, status, is_active, created_at, updated_at
     FROM institutions WHERE id = $1`,
    [id],
  );
  return result.rowCount ? mapInstitution(result.rows[0]) : null;
}

export async function createInstitution(
  input: InstitutionCreateInput,
  actorId: string,
): Promise<Institution> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO institutions
         (name, short_name, code, admission_code, institution_type, address, official_website,
          city, data_source_url, data_collected_at, contact_email, contact_phone, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'DRAFT', FALSE)
       RETURNING id, name, short_name, code, admission_code, institution_type, address,
                 official_website, city, data_source_url, data_collected_at,
                 contact_email, contact_phone, status, is_active, created_at, updated_at`,
      [
        input.name,
        input.shortName ?? null,
        input.code || null,
        input.admissionCode ?? null,
        input.institutionType ?? "UNIVERSITY",
        input.address ?? null,
        input.officialWebsite ?? null,
        input.city ?? null,
        input.dataSourceUrl ?? null,
        input.dataCollectedAt ?? null,
        input.contactEmail ?? null,
        input.contactPhone ?? null,
      ],
    );
    const institution = mapInstitution(result.rows[0]);
    await client.query(
      `INSERT INTO institution_change_history (institution_id, actor_id, action, after_data)
       VALUES ($1, $2, 'CREATED', $3::jsonb)`,
      [institution.id, actorId, JSON.stringify(institution)],
    );
    await client.query("COMMIT");
    return institution;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateInstitution(
  id: string,
  input: InstitutionUpdateInput,
  actorId: string,
): Promise<Institution | null> {
  const pool = getPool();
  const client = await pool.connect();
  const columns: Record<keyof InstitutionUpdateInput, string> = {
    name: "name",
    code: "code",
    shortName: "short_name",
    admissionCode: "admission_code",
    institutionType: "institution_type",
    address: "address",
    officialWebsite: "official_website",
    city: "city",
    contactEmail: "contact_email",
    contactPhone: "contact_phone",
  };
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT id, name, short_name, code, admission_code, institution_type, address,
              official_website, city, data_source_url, data_collected_at,
              contact_email, contact_phone, status, is_active, created_at, updated_at
       FROM institutions WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const before = mapInstitution(currentResult.rows[0]);
    const assignments: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(columns) as Array<[keyof InstitutionUpdateInput, string]>) {
      if (input[key] === undefined) continue;
      values.push(input[key] === "" ? null : input[key]);
      assignments.push(`${column} = $${values.length}`);
    }
    if (assignments.length) {
      assignments.push("updated_at = NOW()");
    }
    values.push(id);
    const result = assignments.length
      ? await client.query(
          `UPDATE institutions SET ${assignments.join(", ")}
           WHERE id = $${values.length}
           RETURNING id, name, short_name, code, admission_code, institution_type, address,
                     official_website, city, data_source_url, data_collected_at,
                     contact_email, contact_phone, status, is_active, created_at, updated_at`,
          values,
        )
      : currentResult;
    const institution = mapInstitution(result.rows[0]);
    if (assignments.length) {
      await client.query(
        `INSERT INTO institution_change_history
           (institution_id, actor_id, action, before_data, after_data)
         VALUES ($1, $2, 'UPDATED', $3::jsonb, $4::jsonb)`,
        [id, actorId, JSON.stringify(before), JSON.stringify(institution)],
      );
    }
    await client.query("COMMIT");
    return institution;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateInstitutionStatus(
  id: string,
  status: Institution["status"],
  actorId: string,
): Promise<Institution | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `SELECT id, name, short_name, code, admission_code, institution_type, address,
              official_website, city, data_source_url, data_collected_at,
              contact_email, contact_phone, status, is_active, created_at, updated_at
       FROM institutions WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!currentResult.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const before = mapInstitution(currentResult.rows[0]);
    const result = await client.query(
      `UPDATE institutions SET status = $2, is_active = ($2 = 'ACTIVE'), updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, short_name, code, admission_code, institution_type, address,
                 official_website, city, data_source_url, data_collected_at,
                 contact_email, contact_phone, status, is_active, created_at, updated_at`,
      [id, status],
    );
    const institution = mapInstitution(result.rows[0]);
    await client.query(
      `INSERT INTO institution_change_history
         (institution_id, actor_id, action, before_data, after_data)
       VALUES ($1, $2, 'STATUS_CHANGED', $3::jsonb, $4::jsonb)`,
      [id, actorId, JSON.stringify(before), JSON.stringify(institution)],
    );
    await client.query("COMMIT");
    return institution;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listInstitutionHistory(institutionId: string): Promise<Array<{
  id: number;
  actorId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  changedAt: string;
}>> {
  const pool = getPool();
  const result = await pool.query<{
    id: string;
    actor_id: string;
    action: string;
    before_data: Record<string, unknown> | null;
    after_data: Record<string, unknown>;
    changed_at: Date;
  }>(
    `SELECT id, actor_id, action, before_data, after_data, changed_at
     FROM institution_change_history
     WHERE institution_id = $1
     ORDER BY changed_at DESC
     LIMIT 200`,
    [institutionId],
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    actorId: row.actor_id,
    action: row.action,
    before: row.before_data,
    after: row.after_data,
    changedAt: row.changed_at.toISOString(),
  }));
}

function mapRoster(row: {
  id: string;
  team_id: string;
  tournament_id: string;
  player_id: string;
  lineup_role: string;
  is_goalkeeper: boolean;
  evidence_url: string | null;
  is_verified: boolean;
  verified_at: string | null;
  review_status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}): Roster {
  return {
    id: row.id,
    teamId: row.team_id,
    tournamentId: row.tournament_id,
    playerId: row.player_id,
    lineupRole: row.lineup_role as Roster["lineupRole"],
    isGoalkeeper: row.is_goalkeeper,
    evidenceUrl: row.evidence_url,
    isVerified: row.is_verified,
    verifiedAt: row.verified_at,
    reviewStatus: row.review_status as Roster["reviewStatus"],
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

export async function listRosters(tournamentId: string, teamId?: string): Promise<Roster[]> {
  const pool = getPool();
  let query = `SELECT id, team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url, is_verified, verified_at,
                      review_status, review_note, reviewed_by, reviewed_at, created_at
               FROM rosters WHERE tournament_id = $1`;
  const params: unknown[] = [tournamentId];
  if (teamId) {
    query += ` AND team_id = $2`;
    params.push(teamId);
  }
  query += ` ORDER BY team_id, created_at`;
  const result = await pool.query(query, params);
  return result.rows.map(mapRoster);
}

export async function createRoster(input: RosterCreateInput): Promise<Roster> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO rosters (team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url, is_verified, verified_at,
               review_status, review_note, reviewed_by, reviewed_at, created_at`,
    [input.teamId, input.tournamentId, input.playerId, input.lineupRole ?? "SUBSTITUTE", input.isGoalkeeper ?? false, input.evidenceUrl ?? null],
  );
  return mapRoster(result.rows[0]);
}

export async function createRostersBatch(inputs: RosterCreateInput[]): Promise<Roster[]> {
  if (!inputs.length) return [];
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const created: Roster[] = [];
    for (const input of inputs) {
      const result = await client.query(
        `INSERT INTO rosters (team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url, is_verified, verified_at,
                   review_status, review_note, reviewed_by, reviewed_at, created_at`,
        [input.teamId, input.tournamentId, input.playerId, input.lineupRole ?? "SUBSTITUTE", input.isGoalkeeper ?? false, input.evidenceUrl ?? null],
      );
      created.push(mapRoster(result.rows[0]));
    }
    await client.query("COMMIT");
    return created;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findRosterById(id: string): Promise<Roster | null> {
  const result = await getPool().query(
    `SELECT id, team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url, is_verified, verified_at,
            review_status, review_note, reviewed_by, reviewed_at, created_at
     FROM rosters WHERE id = $1`,
    [id],
  );
  return result.rowCount ? mapRoster(result.rows[0]) : null;
}

export async function reviewRoster(
  tournamentId: string,
  id: string,
  status: Roster["reviewStatus"],
  note: string | null,
  reviewerId: string,
): Promise<Roster | null> {
  const result = await getPool().query(
    `UPDATE rosters
     SET review_status = $3,
         review_note = $4,
         reviewed_by = $5,
         reviewed_at = NOW(),
         is_verified = ($3 = 'APPROVED'),
         verified_at = CASE WHEN $3 = 'APPROVED' THEN NOW() ELSE NULL END
     WHERE id = $1 AND tournament_id = $2
     RETURNING id, team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url, is_verified, verified_at,
               review_status, review_note, reviewed_by, reviewed_at, created_at`,
    [id, tournamentId, status, note, reviewerId],
  );
  return result.rowCount ? mapRoster(result.rows[0]) : null;
}

export async function updateRosterEvidence(
  tournamentId: string,
  id: string,
  evidenceUrl: string | null,
): Promise<Roster | null> {
  const result = await getPool().query(
    `UPDATE rosters
     SET evidence_url = $3, review_status = 'PENDING', review_note = NULL,
         reviewed_by = NULL, reviewed_at = NULL, is_verified = FALSE, verified_at = NULL
     WHERE id = $1 AND tournament_id = $2
     RETURNING id, team_id, tournament_id, player_id, lineup_role, is_goalkeeper, evidence_url, is_verified, verified_at,
               review_status, review_note, reviewed_by, reviewed_at, created_at`,
    [id, tournamentId, evidenceUrl],
  );
  return result.rowCount ? mapRoster(result.rows[0]) : null;
}

export async function deleteRoster(tournamentId: string, id: string): Promise<boolean> {
  const result = await getPool().query(
    "DELETE FROM rosters WHERE id = $1 AND tournament_id = $2",
    [id, tournamentId],
  );
  return (result.rowCount ?? 0) > 0;
}

function mapPlayerRequest(row: {
  id: string;
  team_id: string;
  user_id: string;
  full_name: string | null;
  birth_date: string | null;
  student_id: string | null;
  contact_email: string | null;
  profile_data: Record<string, string | null> | null;
  message: string | null;
  status: string;
  created_at: string;
  responded_at: string | null;
  reviewed_by: string | null;
  decision_reason: string | null;
}): PlayerRequest {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    fullName: row.full_name,
    birthDate: row.birth_date,
    studentId: row.student_id,
    contactEmail: row.contact_email,
    profileData: row.profile_data ?? {},
    message: row.message,
    status: row.status as any,
    createdAt: row.created_at,
    respondedAt: row.responded_at,
    reviewedBy: row.reviewed_by,
    decisionReason: row.decision_reason,
  };
}

export async function listPlayerRequests(teamId: string, status?: string): Promise<PlayerRequest[]> {
  const pool = getPool();
  let query = `SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, profile_data, message, status, created_at, responded_at, reviewed_by, decision_reason FROM player_requests WHERE team_id = $1`;
  const params: unknown[] = [teamId];
  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }
  query += ` ORDER BY created_at DESC`;
  const result = await pool.query(query, params);
  return result.rows.map(mapPlayerRequest);
}

export async function listPlayerRequestsForUser(userId: string): Promise<PlayerRequest[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, profile_data, message, status, created_at, responded_at, reviewed_by, decision_reason
     FROM player_requests WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows.map(mapPlayerRequest);
}

export async function findPlayerRequestById(id: string): Promise<PlayerRequest | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, profile_data, message, status, created_at, responded_at, reviewed_by, decision_reason
     FROM player_requests WHERE id = $1`,
    [id],
  );
  if (result.rowCount === 0) return null;
  return mapPlayerRequest(result.rows[0]);
}

export async function createPlayerRequest(input: PlayerRequestCreateInput): Promise<PlayerRequest> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const team = await client.query<{ is_active: boolean }>(
      "SELECT is_active FROM teams WHERE id = $1 FOR UPDATE",
      [input.teamId],
    );
    if (!team.rowCount || !team.rows[0].is_active) {
      throw new AppError(404, "Active team not found", "TEAM_NOT_FOUND");
    }
    const activeMembership = await client.query(
      "SELECT 1 FROM players WHERE user_id = $1 AND left_at IS NULL",
      [input.userId],
    );
    if (activeMembership.rowCount) {
      throw new AppError(409, "Player already belongs to an active team", "PLAYER_ALREADY_IN_TEAM");
    }
    const result = await client.query(
      `INSERT INTO player_requests
         (team_id, user_id, full_name, birth_date, student_id, contact_email, profile_data, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING id, team_id, user_id, full_name, birth_date, student_id, contact_email, profile_data, message, status, created_at, responded_at, reviewed_by, decision_reason`,
      [
        input.teamId,
        input.userId,
        input.fullName,
        input.birthDate ?? null,
        input.studentId ?? null,
        input.contactEmail ?? null,
        JSON.stringify(input.profileData ?? {}),
        input.message ?? null,
      ],
    );
    await client.query("COMMIT");
    return mapPlayerRequest(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "A pending request for this team already exists", "APPLICATION_PENDING");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePlayerRequest(
  id: string,
  status: string,
  reviewerId: string,
  decisionReason: string | null,
): Promise<PlayerRequest | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      id: string;
      team_id: string;
      user_id: string;
      full_name: string | null;
      birth_date: string | null;
      student_id: string | null;
      contact_email: string | null;
      message: string | null;
      status: string;
    }>(
      `SELECT id, team_id, user_id, full_name, birth_date, student_id,
              contact_email, profile_data, message, status
       FROM player_requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }
    const request = current.rows[0];
    if (request.user_id === reviewerId) {
      throw new AppError(403, "You cannot review your own team request", "SELF_REVIEW_FORBIDDEN");
    }
    if (request.status !== "PENDING") {
      throw new AppError(409, "Player request has already been reviewed", "REQUEST_ALREADY_REVIEWED");
    }

    if (status === "APPROVED") {
      const team = await client.query<{ max_players: number; is_active: boolean }>(
        "SELECT max_players, is_active FROM teams WHERE id = $1 FOR UPDATE",
        [request.team_id],
      );
      if (!team.rowCount) {
        throw new AppError(404, "Team not found", "TEAM_NOT_FOUND");
      }
      if (!team.rows[0].is_active) {
        throw new AppError(409, "Inactive teams cannot add players", "TEAM_INACTIVE");
      }
      const activeTeam = await client.query<{ team_id: string }>(
        `SELECT team_id FROM players
         WHERE user_id = $1 AND left_at IS NULL
         FOR UPDATE`,
        [request.user_id],
      );
      if (activeTeam.rowCount) {
        throw new AppError(409, "Player already belongs to an active team", "PLAYER_ALREADY_IN_TEAM");
      }
      const capacity = await client.query<{ active_count: string }>(
        `SELECT COUNT(*)::text AS active_count FROM players
         WHERE team_id = $1 AND left_at IS NULL`,
        [request.team_id],
      );
      if (!capacity.rowCount || Number(capacity.rows[0].active_count) >= team.rows[0].max_players) {
        throw new AppError(409, "Team has reached its player limit", "TEAM_ROSTER_FULL");
      }
      await client.query(
        `INSERT INTO players (team_id, user_id, full_name, birth_date, student_id, contact_email)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (team_id, user_id) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               birth_date = EXCLUDED.birth_date,
               student_id = EXCLUDED.student_id,
               contact_email = EXCLUDED.contact_email,
               left_at = NULL`,
        [
          request.team_id,
          request.user_id,
          request.full_name,
          request.birth_date,
          request.student_id,
          request.contact_email,
        ],
      );
    }

    const updated = await client.query(
      `UPDATE player_requests
       SET status = $1, responded_at = NOW(), reviewed_by = $2, decision_reason = $3
       WHERE id = $4
      RETURNING id, team_id, user_id, full_name, birth_date, student_id, contact_email, profile_data, message, status, created_at, responded_at, reviewed_by, decision_reason`,
      [status, reviewerId, decisionReason, id],
    );
    await client.query("COMMIT");
    return mapPlayerRequest(updated.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string }).code === "23505") {
      throw new AppError(409, "Player already belongs to an active team", "PLAYER_ALREADY_IN_TEAM");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withdrawPlayerRequest(id: string, userId: string): Promise<PlayerRequest | null> {
  const result = await getPool().query(
    `UPDATE player_requests
     SET status = 'WITHDRAWN', responded_at = NOW(), withdrawn_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'PENDING'
     RETURNING id, team_id, user_id, full_name, birth_date, student_id, contact_email, profile_data,
               message, status, created_at, responded_at, reviewed_by, decision_reason`,
    [id, userId],
  );
  return result.rowCount ? mapPlayerRequest(result.rows[0]) : null;
}

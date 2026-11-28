import type {
  Team,
  TeamCreateInput,
  TeamUpdateInput,
  TeamRegistration,
  TeamRegistrationCreateInput,
  TeamRegistrationUpdateInput,
  Player,
  PlayerCreateInput,
  PlayerUpdateInput,
} from "../models/team";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";

// Teams
function mapTeam(row: {
  id: string;
  name: string;
  short_name: string | null;
  description: string | null;
  logo_url: string | null;
  institution_id: string | null;
  institution_name?: string | null;
  unit_name: string | null;
  representative_name: string | null;
  kit_color: string | null;
  captain_id: string;
  is_player?: boolean;
  contact_email: string | null;
  contact_phone: string | null;
  max_players: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): Team {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    description: row.description,
    logoUrl: row.logo_url,
    institutionId: row.institution_id,
    ...(row.institution_name !== undefined ? { institutionName: row.institution_name } : {}),
    unitName: row.unit_name,
    representativeName: row.representative_name,
    kitColor: row.kit_color,
    captainId: row.captain_id,
    ...(row.is_player === undefined ? {} : { isPlayer: row.is_player }),
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    maxPlayers: row.max_players,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findTeamById(id: string): Promise<Team | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT t.id, t.name, t.short_name, t.description, t.logo_url, t.institution_id, i.name AS institution_name,
            t.unit_name, t.representative_name, t.kit_color, t.captain_id,
            t.contact_email, t.contact_phone, t.max_players, t.is_active, t.created_at, t.updated_at
     FROM teams t LEFT JOIN institutions i ON i.id = t.institution_id
     WHERE t.id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapTeam(result.rows[0]);
}

export async function findPublicTeamDetail(id: string): Promise<{
  team: {
    id: string;
    name: string;
    shortName: string | null;
    description: string | null;
    logoUrl: string | null;
    institutionId: string | null;
    institutionName: string | null;
    unitName: string | null;
    representativeName: string | null;
    kitColor: string | null;
    tournamentIds: string[];
  };
  players: Array<{
    id: string;
    fullName: string | null;
    jerseyNumber: number | null;
    position: string | null;
    teamRole: "CAPTAIN" | "PLAYER";
  }>;
} | null> {
  const pool = getPool();
  const teamResult = await pool.query<{
    id: string;
    name: string;
    short_name: string | null;
    description: string | null;
    logo_url: string | null;
    institution_id: string | null;
    institution_name: string | null;
    unit_name: string | null;
    representative_name: string | null;
    kit_color: string | null;
    tournament_ids: string[];
  }>(
    `SELECT t.id, t.name, t.short_name, t.description, t.logo_url,
            t.institution_id, i.name AS institution_name, t.unit_name,
            t.representative_name, t.kit_color,
            COALESCE(
              ARRAY_AGG(DISTINCT tr.tournament_id) FILTER (WHERE tr.status = 'APPROVED'),
              ARRAY[]::UUID[]
            ) AS tournament_ids
     FROM teams t
     LEFT JOIN institutions i ON i.id = t.institution_id
     LEFT JOIN team_registrations tr ON tr.team_id = t.id
     WHERE t.id = $1 AND t.is_active = TRUE
     GROUP BY t.id, i.name`,
    [id],
  );
  if (!teamResult.rowCount) return null;
  const playerResult = await pool.query<{
    id: string;
    full_name: string | null;
    jersey_number: number | null;
    position: string | null;
    is_captain: boolean;
  }>(
    `SELECT id, full_name, jersey_number, position, is_captain
     FROM players
     WHERE team_id = $1 AND left_at IS NULL
     ORDER BY jersey_number NULLS LAST, full_name`,
    [id],
  );
  const row = teamResult.rows[0];
  return {
    team: {
      id: row.id,
      name: row.name,
      shortName: row.short_name,
      description: row.description,
      logoUrl: row.logo_url,
      institutionId: row.institution_id,
      institutionName: row.institution_name,
      unitName: row.unit_name,
      representativeName: row.representative_name,
      kitColor: row.kit_color,
      tournamentIds: row.tournament_ids,
    },
    players: playerResult.rows.map((player) => ({
      id: player.id,
      fullName: player.full_name,
      jerseyNumber: player.jersey_number,
      position: player.position,
      teamRole: player.is_captain ? "CAPTAIN" : "PLAYER",
    })),
  };
}

export async function findTeamsForUser(userId: string): Promise<Team[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT t.id, t.name, t.short_name, t.description, t.logo_url, t.institution_id, i.name AS institution_name, t.unit_name, t.representative_name, t.kit_color, t.captain_id,
            EXISTS (SELECT 1 FROM players p WHERE p.team_id = t.id AND p.user_id = $1 AND p.left_at IS NULL) AS is_player,
            t.contact_email, t.contact_phone, t.max_players, t.is_active, t.created_at, t.updated_at
     FROM teams t LEFT JOIN institutions i ON i.id = t.institution_id
     WHERE t.captain_id = $1
        OR EXISTS (
          SELECT 1 FROM players p
          WHERE p.team_id = t.id AND p.user_id = $1 AND p.left_at IS NULL
        )
     ORDER BY t.created_at DESC`,
    [userId],
  );

  return result.rows.map(mapTeam);
}

export async function findTeamsManagedByUser(userId: string): Promise<Team[]> {
  const result = await getPool().query(
    `SELECT t.id, t.name, t.short_name, t.description, t.logo_url, t.institution_id, i.name AS institution_name, t.unit_name, t.representative_name, t.kit_color,
            t.captain_id, t.contact_email, t.contact_phone, t.max_players, t.is_active, t.created_at, t.updated_at
     FROM teams t LEFT JOIN institutions i ON i.id = t.institution_id WHERE t.captain_id = $1 ORDER BY t.created_at DESC`,
    [userId],
  );
  return result.rows.map(mapTeam);
}

export async function listTeams(
  limit: number,
  offset: number,
  isActive?: boolean,
  institutionId?: string,
  search?: string,
  sortBy: "NAME" | "CREATED_AT" = "CREATED_AT",
): Promise<{ items: Team[]; total: number }> {
  const pool = getPool();

  const conditions: string[] = [];
  const filterParams: unknown[] = [];
  if (isActive !== undefined) {
    filterParams.push(isActive);
    conditions.push(`is_active = $${filterParams.length}`);
  }
  if (institutionId) {
    filterParams.push(institutionId);
    conditions.push(`institution_id = $${filterParams.length}`);
  }
  if (search?.trim()) {
    filterParams.push(`%${search.trim()}%`);
    conditions.push(`(name ILIKE $${filterParams.length} OR short_name ILIKE $${filterParams.length})`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const countQuery = `SELECT COUNT(*)::text AS count FROM teams ${whereClause}`;
  let listQuery = `
    SELECT id, name, short_name, description, logo_url, institution_id, unit_name, representative_name, kit_color, captain_id, contact_email, contact_phone, max_players, is_active, created_at, updated_at
    FROM teams ${whereClause}
  `;
  const paginationParams = [...filterParams, limit, offset];
    const sortColumn = sortBy === "NAME" ? "name" : "created_at";
    const sortDirection = sortBy === "NAME" ? "ASC" : "DESC";
    listQuery += ` ORDER BY ${sortColumn} ${sortDirection}, id ASC LIMIT $${paginationParams.length - 1} OFFSET $${paginationParams.length}`;
  const countResult = await pool.query<{ count: string }>(countQuery, filterParams);
  const total = Number(countResult.rows[0]?.count ?? 0);

  const result = await pool.query(listQuery, paginationParams);

  return {
    items: result.rows.map(mapTeam),
    total,
  };
}

export async function createTeam(input: TeamCreateInput): Promise<Team> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO teams (name, short_name, description, logo_url, institution_id, unit_name, representative_name, kit_color, captain_id, contact_email, contact_phone, max_players)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, name, short_name, description, logo_url, institution_id, unit_name, representative_name, kit_color, captain_id, contact_email, contact_phone, max_players, is_active, created_at, updated_at`,
    [
      input.name,
      input.shortName ?? null,
      input.description ?? null,
      input.logoUrl ?? null,
      input.institutionId,
      input.unitName ?? null,
      input.representativeName ?? null,
      input.kitColor ?? null,
      input.captainId,
      input.contactEmail ?? null,
      input.contactPhone ?? null,
      input.maxPlayers ?? 25,
    ],
  );

  return mapTeam(result.rows[0]);
}

export async function linkTeamToInstitutionIfUnlinked(teamId: string, institutionId: string): Promise<Team | null> {
  const result = await getPool().query(
    `UPDATE teams SET institution_id = $2, updated_at = NOW()
     WHERE id = $1 AND institution_id IS NULL
     RETURNING id, name, short_name, description, logo_url, institution_id, unit_name, representative_name, kit_color, captain_id, contact_email, contact_phone, max_players, is_active, created_at, updated_at`,
    [teamId, institutionId],
  );
  return result.rowCount ? mapTeam(result.rows[0]) : null;
}

export async function updateTeam(id: string, input: TeamUpdateInput): Promise<Team | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.shortName !== undefined) {
    sets.push(`short_name = $${idx++}`);
    values.push(input.shortName);
  }
  if (input.description !== undefined) {
    sets.push(`description = $${idx++}`);
    values.push(input.description);
  }
  if (input.logoUrl !== undefined) {
    sets.push(`logo_url = $${idx++}`);
    values.push(input.logoUrl);
  }
  if (input.institutionId !== undefined) {
    sets.push(`institution_id = $${idx++}`);
    values.push(input.institutionId);
  }
  if (input.unitName !== undefined) {
    sets.push(`unit_name = $${idx++}`);
    values.push(input.unitName);
  }
  if (input.representativeName !== undefined) {
    sets.push(`representative_name = $${idx++}`);
    values.push(input.representativeName);
  }
  if (input.kitColor !== undefined) {
    sets.push(`kit_color = $${idx++}`);
    values.push(input.kitColor);
  }
  if (input.captainId !== undefined) {
    sets.push(`captain_id = $${idx++}`);
    values.push(input.captainId);
  }
  if (input.contactEmail !== undefined) {
    sets.push(`contact_email = $${idx++}`);
    values.push(input.contactEmail);
  }
  if (input.contactPhone !== undefined) {
    sets.push(`contact_phone = $${idx++}`);
    values.push(input.contactPhone);
  }
  if (input.maxPlayers !== undefined) {
    sets.push(`max_players = $${idx++}`);
    values.push(input.maxPlayers);
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(input.isActive);
  }

  if (sets.length === 0) {
    return findTeamById(id);
  }

  sets.push("updated_at = NOW()");
  values.push(id);

  await pool.query(
    `UPDATE teams SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  return findTeamById(id);
}

export async function deleteTeam(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM teams WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// Team Registrations
function mapTeamRegistration(row: {
  id: string;
  team_id: string;
  tournament_id: string;
  status: string;
    version?: number | string;
  registered_at: string;
  submitted_at?: string | null;
  submission_sequence?: string | number;
  supplement_deadline?: string | null;
  supplement_completed_at?: string | null;
  is_next_in_queue?: boolean;
  roster_count?: number | string;
  confirmed_roster_count?: number | string;
  approved_at: string | null;
  approved_by: string | null;
  notes: string | null;
  institution_id?: string | null;
  institution_name?: string | null;
  registration_conflicts?: unknown;
  adjustment_deadline?: string | null;
  resubmission_allowed?: boolean;
  waitlist_reason?: "TOURNAMENT_CAPACITY" | "INSTITUTION_CAPACITY" | null;
}): TeamRegistration {
  return {
    id: row.id,
    teamId: row.team_id,
    tournamentId: row.tournament_id,
    status: row.status as any,
    version: Number(row.version ?? 1),
    registeredAt: row.registered_at,
    submittedAt: row.submitted_at ?? row.registered_at,
    submissionSequence: Number(row.submission_sequence ?? 0),
    supplementDeadline: row.supplement_deadline ?? null,
    supplementCompletedAt: row.supplement_completed_at ?? null,
    ...(row.roster_count !== undefined ? { rosterCount: Number(row.roster_count) } : {}),
    ...(row.confirmed_roster_count !== undefined ? { confirmedRosterCount: Number(row.confirmed_roster_count) } : {}),
    ...(row.is_next_in_queue !== undefined ? { isNextInQueue: row.is_next_in_queue } : {}),
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    notes: row.notes,
    institutionId: row.institution_id ?? null,
    registrationConflicts: Array.isArray(row.registration_conflicts) ? row.registration_conflicts : [],
    adjustmentDeadline: row.adjustment_deadline ?? null,
    resubmissionAllowed: row.resubmission_allowed === true,
    waitlistReason: row.waitlist_reason ?? null,
    waitlistReady: row.status === "WAITLIST" || row.status === "PENDING",
    ...(row.institution_name !== undefined ? { institutionName: row.institution_name } : {}),
  };
}

export async function findTeamRegistration(
  teamId: string,
  tournamentId: string,
): Promise<TeamRegistration | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at,
            tr.approved_by, tr.notes, tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
            COALESCE(tr.institution_id, t.institution_id) AS institution_id
     FROM team_registrations tr
     JOIN teams t ON t.id = tr.team_id
     WHERE tr.team_id = $1 AND tr.tournament_id = $2`,
    [teamId, tournamentId],
  );

  if (result.rowCount === 0) return null;
  return mapTeamRegistration(result.rows[0]);
}

export async function listTeamRegistrationsByTeam(teamId: string): Promise<TeamRegistration[]> {
  const result = await getPool().query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at,
            tr.approved_by, tr.notes, tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed,
            COALESCE(tr.institution_id, t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id = tr.team_id
     WHERE tr.team_id = $1 ORDER BY tr.registered_at DESC`,
    [teamId],
  );
  return result.rows.map(mapTeamRegistration);
}

export async function listConflictAdjustmentRegistrations(limit = 100): Promise<TeamRegistration[]> {
  const result = await getPool().query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at, tr.approved_by, tr.notes,
            tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
            COALESCE(tr.institution_id,t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id=tr.team_id
     WHERE tr.status='CONFLICT_ADJUSTMENT_REQUIRED'
     ORDER BY tr.adjustment_deadline NULLS FIRST, tr.submitted_at LIMIT $1`, [limit],
  );
  return result.rows.map(mapTeamRegistration);
}

export async function listWaitlistRegistrations(limit = 100): Promise<TeamRegistration[]> {
  const result = await getPool().query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at, tr.approved_by, tr.notes,
            tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
            COALESCE(tr.institution_id,t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id=tr.team_id
     WHERE tr.status='WAITLIST' OR tr.waitlist_reason IS NOT NULL
     ORDER BY tr.submitted_at LIMIT $1`, [limit],
  );
  return result.rows.map(mapTeamRegistration);
}

export async function listReviewableRegistrationsForFinalization(tournamentId?: string, limit = 200): Promise<TeamRegistration[]> {
  const result = await getPool().query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at, tr.approved_by, tr.notes,
            tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
            COALESCE(tr.institution_id,t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id=tr.team_id
     WHERE tr.status IN ('PENDING','WAITLIST','NEEDS_SUPPLEMENT','REVISION_REQUIRED','CONFLICT_ADJUSTMENT_REQUIRED')
       AND ($1::uuid IS NULL OR tr.tournament_id=$1)
     ORDER BY tr.submission_sequence,tr.submitted_at LIMIT $2`,
    [tournamentId ?? null, limit],
  );
  return result.rows.map(mapTeamRegistration);
}

export async function listSupplementRegistrationsForExpiry(limit = 200): Promise<TeamRegistration[]> {
  const result = await getPool().query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at, tr.approved_by, tr.notes,
            tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
            COALESCE(tr.institution_id,t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id=tr.team_id
     WHERE tr.status IN ('NEEDS_SUPPLEMENT','REVISION_REQUIRED')
     ORDER BY tr.supplement_deadline NULLS FIRST,tr.submitted_at LIMIT $1`, [limit],
  );
  return result.rows.map(mapTeamRegistration);
}

export async function listApprovedRegistrationPlayerClaims(): Promise<Array<{
  registrationId: string; tournamentId: string; teamId: string; institutionId: string; playerIds: string[];
    status: "PENDING" | "APPROVED" | "WAITLIST" | "CONFLICT_ADJUSTMENT_REQUIRED";
}>> {
  const result = await getPool().query<{
    registration_id: string; tournament_id: string; team_id: string; institution_id: string; player_ids: string[]; status: string;
  }>(
     `SELECT tr.id AS registration_id, tr.tournament_id, tr.team_id,
            CASE WHEN tr.status IN ('NEEDS_SUPPLEMENT','REVISION_REQUIRED') THEN 'PENDING' ELSE tr.status END AS status,
            COALESCE(tr.institution_id,t.institution_id) AS institution_id,
            ARRAY_AGG(DISTINCT roster.player_id ORDER BY roster.player_id) AS player_ids
     FROM team_registrations tr
     JOIN teams t ON t.id=tr.team_id
     JOIN rosters roster ON roster.team_id=tr.team_id AND roster.tournament_id=tr.tournament_id
     WHERE tr.status IN ('PENDING','APPROVED','WAITLIST','CONFLICT_ADJUSTMENT_REQUIRED','NEEDS_SUPPLEMENT','REVISION_REQUIRED')
       AND COALESCE(tr.institution_id,t.institution_id) IS NOT NULL
     GROUP BY tr.id, tr.tournament_id, tr.team_id, COALESCE(tr.institution_id,t.institution_id)
     ORDER BY MIN(tr.approved_at) NULLS LAST, tr.id`,
  );
  return result.rows.map((row) => ({
    registrationId: row.registration_id,
    tournamentId: row.tournament_id,
    teamId: row.team_id,
    institutionId: row.institution_id,
    playerIds: row.player_ids,
    status: row.status as "PENDING" | "APPROVED" | "WAITLIST" | "CONFLICT_ADJUSTMENT_REQUIRED",
  }));
}

export async function findTeamRegistrationById(id: string): Promise<TeamRegistration | null> {
  const result = await getPool().query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at,
            tr.approved_by, tr.notes, tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
            COALESCE(tr.institution_id, t.institution_id) AS institution_id
     FROM team_registrations tr
     JOIN teams t ON t.id = tr.team_id
     WHERE tr.id = $1`,
    [id],
  );
  if (result.rowCount === 0) return null;
  return mapTeamRegistration(result.rows[0]);
}

export async function listTournamentIdsByTeam(teamId: string): Promise<string[]> {
  const result = await getPool().query<{ tournament_id: string }>(
    `SELECT tournament_id
     FROM team_registrations
     WHERE team_id = $1`,
    [teamId],
  );
  return result.rows.map((row) => row.tournament_id);
}

export async function listTeamRegistrations(
  tournamentId: string,
  filters: { status?: string; institutionId?: string; search?: string } = {},
): Promise<TeamRegistration[]> {
  const pool = getPool();
  let query = `
    SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
           tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at,
           tr.approved_by, tr.notes, tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
           COALESCE(tr.institution_id, t.institution_id) AS institution_id,
           jsonb_array_length(tr.submitted_roster) AS roster_count,
           (SELECT COUNT(*)::INTEGER FROM tournament_player_invitations invitation
             WHERE invitation.team_id=tr.team_id AND invitation.tournament_id=tr.tournament_id
               AND invitation.status='ACCEPTED' AND invitation.expires_at>NOW()) AS confirmed_roster_count,
           i.name AS institution_name,
           (tr.status = 'PENDING' AND tr.id = (
             SELECT head.id FROM team_registrations head
             WHERE head.tournament_id = tr.tournament_id AND head.status = 'PENDING'
             ORDER BY head.submission_sequence ASC LIMIT 1
           )) AS is_next_in_queue
    FROM team_registrations tr
    JOIN teams t ON t.id = tr.team_id
    LEFT JOIN institutions i ON i.id = COALESCE(tr.institution_id, t.institution_id)
    WHERE tr.tournament_id = $1
  `;
  const params: unknown[] = [tournamentId];

  if (filters.status) {
    params.push(filters.status);
    query += ` AND tr.status = $${params.length}`;
  }
  if (filters.institutionId) {
    params.push(filters.institutionId);
    query += ` AND COALESCE(tr.institution_id, t.institution_id) = $${params.length}`;
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    query += ` AND (t.name ILIKE $${params.length} OR COALESCE(i.name, '') ILIKE $${params.length})`;
  }

  query += ` ORDER BY tr.submission_sequence ASC, tr.id ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapTeamRegistration);
}

export async function getNextPendingRegistrationId(tournamentId: string): Promise<string | null> {
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM team_registrations WHERE tournament_id=$1 AND status='PENDING'
     ORDER BY submission_sequence ASC, id ASC LIMIT 1`,
    [tournamentId],
  );
  return result.rows[0]?.id ?? null;
}

export async function getNextWaitlistRegistrationId(tournamentId: string): Promise<string | null> {
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM team_registrations
     WHERE tournament_id=$1 AND status='WAITLIST'
     ORDER BY submission_sequence,submitted_at,id LIMIT 1`, [tournamentId],
  );
  return result.rows[0]?.id ?? null;
}

/** Serialize review decisions across BTC accounts while keeping the lock across downstream service calls. */
export async function withTournamentRegistrationReviewLock<T>(
  tournamentId: string,
  action: () => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  const lockKey = `registration-queue:${tournamentId}`;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey]);
    return await action();
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey]); }
    finally { client.release(); }
  }
}

export async function listTournamentRegistrationCounts(
  tournamentId?: string,
  institutionId?: string,
): Promise<Array<{ tournamentId: string; institutionId: string; pending: number; approved: number }>> {
  const result = await getPool().query<{
    tournament_id: string;
    institution_id: string;
    pending: string;
    approved: string;
  }>(
    `SELECT tr.tournament_id, COALESCE(tr.institution_id, t.institution_id) AS institution_id,
            COUNT(*) FILTER (WHERE tr.status IN ('PENDING','NEEDS_SUPPLEMENT','REVISION_REQUIRED'))::text AS pending,
            COUNT(*) FILTER (WHERE tr.status = 'APPROVED')::text AS approved
     FROM team_registrations tr
     JOIN teams t ON t.id = tr.team_id
     WHERE tr.status IN ('PENDING', 'NEEDS_SUPPLEMENT', 'REVISION_REQUIRED', 'APPROVED')
       AND ($1::uuid IS NULL OR tr.tournament_id = $1)
       AND ($2::uuid IS NULL OR COALESCE(tr.institution_id, t.institution_id) = $2)
     GROUP BY tr.tournament_id, COALESCE(tr.institution_id, t.institution_id)`,
    [tournamentId ?? null, institutionId ?? null],
  );
  return result.rows.map((row) => ({
    tournamentId: row.tournament_id,
    institutionId: row.institution_id,
    pending: Number(row.pending),
    approved: Number(row.approved),
  }));
}

export async function listTournamentDrawCandidates(tournamentId: string): Promise<Array<{
  registrationId: string;
  teamId: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  institutionId: string | null;
  institutionName: string | null;
  institutionType: string | null;
  isActive: boolean;
  registrationStatus: string;
  verifiedRosterCount: number;
  totalRosterCount: number;
  verifiedRoster: Array<Record<string, unknown>>;
}>> {
  const result = await getPool().query<{
    team_id: string;
    name: string;
    short_name: string | null;
    logo_url: string | null;
    institution_id: string | null;
    institution_name: string | null;
    institution_type: string | null;
    is_active: boolean;
    registration_status: string;
    registration_id: string;
    verified_roster_count: number;
    total_roster_count: number;
    verified_roster: Array<Record<string, unknown>> | null;
  }>(
    `SELECT tr.id AS registration_id, t.id AS team_id, t.name, t.short_name, t.logo_url, t.institution_id,
            t.is_active,
            i.name AS institution_name, i.institution_type, tr.status AS registration_status,
            COUNT(r.id)::INTEGER AS verified_roster_count,
            COUNT(r.id)::INTEGER AS total_roster_count,
            COALESCE(json_agg(json_build_object(
              'rosterId', r.id, 'playerId', p.id, 'userId', p.user_id,
              'fullName', p.full_name, 'studentId', p.student_id,
              'birthDate', p.birth_date, 'jerseyNumber', p.jersey_number,
              'position', p.position, 'lineupRole', r.lineup_role,
              'isGoalkeeper', r.is_goalkeeper, 'isVerified', FALSE,
              'reviewStatus', r.review_status
            ) ORDER BY r.lineup_role, p.full_name) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS verified_roster
     FROM team_registrations tr
     JOIN teams t ON t.id = tr.team_id
     LEFT JOIN institutions i ON i.id = t.institution_id
     LEFT JOIN rosters r ON r.team_id = tr.team_id AND r.tournament_id = tr.tournament_id
     LEFT JOIN players p ON p.id = r.player_id
     WHERE tr.tournament_id = $1
     GROUP BY tr.id, t.id, i.name, i.institution_type, tr.status
     ORDER BY t.name`,
    [tournamentId],
  );
  return result.rows.map((row) => ({
    registrationId: row.registration_id,
    teamId: row.team_id,
    name: row.name,
    shortName: row.short_name,
    logoUrl: row.logo_url,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    institutionType: row.institution_type,
    isActive: row.is_active,
    registrationStatus: row.registration_status,
    verifiedRosterCount: row.verified_roster_count,
    totalRosterCount: row.total_roster_count,
    verifiedRoster: row.verified_roster ?? [],
  }));
}

export async function createTeamRegistration(
  input: TeamRegistrationCreateInput,
): Promise<TeamRegistration> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`registration-queue:${input.tournamentId}`]);
    const sequence = await client.query<{ next_sequence: string }>(
      "SELECT COALESCE(MAX(submission_sequence), 0)::bigint + 1 AS next_sequence FROM team_registrations WHERE tournament_id=$1",
      [input.tournamentId],
    );
    const result = await client.query(
      `INSERT INTO team_registrations (id, team_id, tournament_id, institution_id, notes, submission_sequence, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id, team_id, tournament_id, status, registered_at, submitted_at, submission_sequence,
         supplement_deadline, supplement_completed_at, approved_at, approved_by, notes, institution_id`,
      [input.id, input.teamId, input.tournamentId, input.institutionId, input.notes ?? null, sequence.rows[0].next_sequence],
    );
    await client.query("COMMIT");
    return mapTeamRegistration(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function saveTeamRegistrationSnapshot(input: {
  registrationId: string; actorId: string;
  roster: Array<Record<string, unknown>>;
}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const snapshot = JSON.stringify(input.roster);
    const updated = await client.query(
      `UPDATE team_registrations SET submitted_roster=$2::jsonb,submitted_at=COALESCE(submitted_at,NOW()) WHERE id=$1 AND status='PENDING' RETURNING version`,
      [input.registrationId, snapshot],
    );
    if (!updated.rowCount) throw new AppError(409, "Registration changed before roster snapshot was saved", "REGISTRATION_SNAPSHOT_CONFLICT");
    await client.query(
      `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,actor_id)
       VALUES ($1,$2,'SUBMITTED',$3::jsonb,$4) ON CONFLICT DO NOTHING`,
      [input.registrationId, updated.rows[0].version, snapshot, input.actorId],
    );
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function appendTeamRegistrationHistory(input: {
  registrationId: string; action: "SUBMITTED" | "RESUBMITTED" | "APPROVED" | "REJECTED" | "REVISION_REQUIRED" | "NEEDS_SUPPLEMENT" | "WITHDRAWN" | "LOCKED" | "APPROVAL_REVIEW_OPENED" | "APPROVAL_REVIEW_RESPONSE" | "APPROVAL_REVIEW_RETAINED" | "APPROVAL_REVOKED" | "WAITLISTED" | "CONFLICT_ADJUSTMENT_REQUIRED" | "ADJUSTMENT_RESUBMITTED" | "ADJUSTMENT_EXPIRED"; actorId: string; note: string | null;
}): Promise<void> {
  await getPool().query(
    `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,note,actor_id)
     SELECT id,version,$2,submitted_roster,$3,$4 FROM team_registrations WHERE id=$1
     ON CONFLICT DO NOTHING`,
    [input.registrationId, input.action, input.note, input.actorId],
  );
}

export async function listTeamRegistrationVersions(registrationId: string) {
  const result = await getPool().query(
    `SELECT version,action,roster_snapshot,note,actor_id,created_at
     FROM team_registration_versions WHERE registration_id=$1 ORDER BY version DESC,created_at DESC`,
    [registrationId],
  );
  return result.rows.map((row) => ({
    version: Number(row.version), action: row.action, rosterSnapshot: row.roster_snapshot ?? [],
    note: row.note, actorId: row.actor_id, createdAt: row.created_at,
  }));
}

export async function updateTeamRegistration(
  id: string,
  input: TeamRegistrationUpdateInput,
  approvedBy?: string,
): Promise<TeamRegistration | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.notes !== undefined) {
    sets.push(`notes = $${idx++}`);
    values.push(input.notes);
  }
  if (input.supplementDeadline !== undefined) {
    sets.push(`supplement_deadline = $${idx++}`);
    values.push(input.supplementDeadline);
  }
  if (input.resubmissionAllowed !== undefined) {
    sets.push(`resubmission_allowed = $${idx++}`);
    values.push(input.resubmissionAllowed);
  }
  if (input.waitlistReason !== undefined) {
    sets.push(`waitlist_reason = $${idx++}`);
    values.push(input.waitlistReason);
  }

  if (input.status === "APPROVED" && approvedBy) {
    sets.push(`approved_at = NOW()`);
    sets.push(`approved_by = $${idx++}`);
    values.push(approvedBy);
  }

  if (sets.length === 0) {
    const existing = await pool.query(
      `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
              tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at,
              tr.approved_by, tr.notes, tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
              COALESCE(tr.institution_id, t.institution_id) AS institution_id
       FROM team_registrations tr JOIN teams t ON t.id = tr.team_id WHERE tr.id = $1`,
      [id],
    );
    if (existing.rowCount === 0) return null;
    return mapTeamRegistration(existing.rows[0]);
  }

  values.push(id);

  const pendingOnly = input.status === "NEEDS_SUPPLEMENT" || input.status === "REVISION_REQUIRED"
    ? " AND status = 'PENDING'"
    : "";
  const noEditInProgress = ["APPROVED", "REJECTED", "NEEDS_SUPPLEMENT", "REVISION_REQUIRED"].includes(input.status ?? "")
    ? " AND NOT EXISTS (SELECT 1 FROM tournament_registration_drafts d WHERE d.registration_id=team_registrations.id AND d.editing_submitted=TRUE)"
    : "";
  const updated = await pool.query(
    `UPDATE team_registrations SET ${sets.join(", ")} WHERE id = $${idx}${pendingOnly}${noEditInProgress}`,
    values,
  );
  if (!updated.rowCount) return null;

  const result = await pool.query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.version, tr.registered_at, tr.submitted_at, tr.submission_sequence,
            tr.supplement_deadline, tr.supplement_completed_at, tr.approved_at,
            tr.approved_by, tr.notes, tr.registration_conflicts, tr.adjustment_deadline, tr.resubmission_allowed, tr.waitlist_reason,
            COALESCE(tr.institution_id, t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id = tr.team_id WHERE tr.id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapTeamRegistration(result.rows[0]);
}

export async function resubmitTeamRegistration(
  id: string,
  captainId: string,
  roster: Array<{ playerId: string; lineupRole: "STARTER" | "SUBSTITUTE"; isGoalkeeper: boolean; competitionRole: string; jerseyNumber: number | null; position: string | null; playerName: string; studentId: string; birthDate?: string | null }>,
): Promise<TeamRegistration | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT tr.*, t.captain_id FROM team_registrations tr JOIN teams t ON t.id=tr.team_id WHERE tr.id=$1 FOR UPDATE`, [id],
    );
    const row = current.rows[0];
    if (row) {
      const pendingDecision = await client.query(
        `SELECT 1 FROM team_registration_decision_outbox WHERE registration_id=$1 AND state IN ('PENDING','PROCESSING') LIMIT 1`,
        [id],
      );
      if (pendingDecision.rowCount) throw new AppError(409, "BTC đang đồng bộ quyết định hồ sơ; tải lại trước khi gửi phiên bản mới.", "REGISTRATION_DECISION_SYNC_PENDING");
    }
      const draft = await client.query(
        `SELECT registration_id,base_version,editing_submitted FROM tournament_registration_drafts WHERE team_id=$1 AND tournament_id=$2 FOR UPDATE`,
        [row?.team_id, row?.tournament_id],
      );
      const canResubmitRejected = row?.status === "REJECTED" && row.resubmission_allowed === true;
      const canResubmitPending = row?.status === "PENDING" && draft.rows[0]?.registration_id === id && draft.rows[0]?.editing_submitted === true && Number(draft.rows[0]?.base_version) === Number(row.version);
      if (!row || row.captain_id !== captainId || !(canResubmitPending || canResubmitRejected || ["REVISION_REQUIRED", "NEEDS_SUPPLEMENT", "CONFLICT_ADJUSTMENT_REQUIRED"].includes(row.status))) {
      await client.query("ROLLBACK");
      return null;
    }
    if (!roster.length) throw new AppError(400, "A non-empty confirmed roster is required", "ROSTER_REQUIRED");
    await client.query("DELETE FROM rosters WHERE team_id=$1 AND tournament_id=$2", [row.team_id, row.tournament_id]);
    for (const entry of roster) {
      const identity = await client.query<{ user_id: string; student_id: string | null }>(
        `SELECT user_id, NULLIF(LOWER(BTRIM(student_id)), '') AS student_id FROM players WHERE id=$1 AND team_id=$2 AND left_at IS NULL AND user_id IS NOT NULL FOR SHARE`,
        [entry.playerId,row.team_id],
      );
      if (!identity.rowCount) throw new AppError(409, "A roster player is no longer an active club member", "INVALID_ROSTER_PLAYER");
      const identityRow = identity.rows[0];
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`tournament-roster:${row.tournament_id}:${identityRow.user_id ?? identityRow.student_id ?? entry.playerId}`]);
      const duplicate = await client.query(
        `SELECT 1 FROM rosters r JOIN team_registrations tr ON tr.team_id=r.team_id AND tr.tournament_id=r.tournament_id
         JOIN players p ON p.id=r.player_id WHERE r.tournament_id=$1 AND r.team_id<>$2 AND tr.status IN ('PENDING','APPROVED')
           AND (($3::uuid IS NOT NULL AND p.user_id=$3::uuid) OR ($4::text IS NOT NULL AND LOWER(BTRIM(p.student_id))=$4::text)) LIMIT 1`,
        [row.tournament_id,row.team_id,identityRow.user_id,identityRow.student_id],
      );
      if (duplicate.rowCount) throw new AppError(409, "Cầu thủ này đã nằm trong hồ sơ dự giải của đội khác", "DUPLICATE_TOURNAMENT_PLAYER");
      const inserted = await client.query(
        `INSERT INTO rosters (team_id,tournament_id,player_id,lineup_role,is_goalkeeper,competition_role,
         jersey_number_snapshot,position_snapshot,player_name_snapshot,student_id_snapshot,is_verified,verified_at,review_status)
         SELECT $1,$2,p.id,$3,$4,$5,$6,$7,p.full_name,p.student_id,FALSE,NULL,'PENDING'
         FROM players p WHERE p.id=$8 AND p.team_id=$1 AND p.left_at IS NULL AND p.user_id IS NOT NULL
         RETURNING id`,
        [row.team_id,row.tournament_id,entry.lineupRole,entry.isGoalkeeper,entry.competitionRole,entry.jerseyNumber,entry.position,entry.playerId],
      );
      if (!inserted.rowCount) throw new AppError(409, "A roster player is no longer an active club member", "INVALID_ROSTER_PLAYER");
    }
    const snapshot = JSON.stringify(roster);
    await client.query(
      `UPDATE team_registrations SET status='PENDING',notes=NULL,version=version+1,resubmission_allowed=FALSE,
       registration_conflicts='[]'::jsonb,adjustment_deadline=NULL,
       waitlist_reason=NULL,
       supplement_completed_at=CASE WHEN status IN ('REVISION_REQUIRED','NEEDS_SUPPLEMENT') THEN NOW() ELSE supplement_completed_at END,
       submitted_roster=$2::jsonb WHERE id=$1`,
      [id, snapshot],
    );
    await client.query(
      `INSERT INTO team_registration_versions(registration_id,version,action,roster_snapshot,actor_id)
       SELECT id,version,CASE WHEN $4::boolean THEN 'ADJUSTMENT_RESUBMITTED' ELSE 'RESUBMITTED' END,$2::jsonb,$3
       FROM team_registrations WHERE id=$1`, [id,snapshot,captainId,row.status === "CONFLICT_ADJUSTMENT_REQUIRED"],
    );
    await client.query("DELETE FROM tournament_registration_drafts WHERE team_id=$1 AND tournament_id=$2", [row.team_id,row.tournament_id]);
    const updated = await client.query(
       `SELECT tr.id,tr.team_id,tr.tournament_id,tr.status,tr.version,tr.registered_at,tr.submitted_at,tr.submission_sequence,
              tr.supplement_deadline,tr.supplement_completed_at,tr.approved_at,tr.approved_by,tr.notes,
              tr.registration_conflicts,tr.adjustment_deadline,tr.resubmission_allowed,
              COALESCE(tr.institution_id,t.institution_id) AS institution_id
       FROM team_registrations tr JOIN teams t ON t.id=tr.team_id WHERE tr.id=$1`, [id],
    );
    await client.query("COMMIT");
    return mapTeamRegistration(updated.rows[0]);
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

// Players
function mapPlayer(row: {
  id: string;
  team_id: string;
  user_id: string | null;
  full_name: string | null;
  birth_date: string | null;
  student_id: string | null;
  contact_email: string | null;
  evidence_url: string | null;
  jersey_number: number | null;
  position: string | null;
  is_captain: boolean;
  joined_at: string;
  left_at: string | null;
}): Player {
  return {
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    fullName: row.full_name,
    birthDate: row.birth_date,
    studentId: row.student_id,
    contactEmail: row.contact_email,
    evidenceUrl: row.evidence_url,
    jerseyNumber: row.jersey_number,
    position: row.position,
    isCaptain: row.is_captain,
    joinedAt: row.joined_at,
    leftAt: row.left_at,
  };
}

export async function listPlayers(teamId: string, includeLeft: boolean = false): Promise<Player[]> {
  const pool = getPool();
  let query = `
    SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, evidence_url, jersey_number, position, is_captain, joined_at, left_at
    FROM players
    WHERE team_id = $1
  `;
  const params: unknown[] = [teamId];

  if (!includeLeft) {
    query += ` AND left_at IS NULL`;
  }

  query += ` ORDER BY joined_at ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapPlayer);
}

export async function listActivePlayerIdsForTeam(teamId: string, playerIds: string[]): Promise<string[]> {
  if (!playerIds.length) return [];
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM players
     WHERE team_id = $1 AND id = ANY($2::uuid[]) AND left_at IS NULL`,
    [teamId, playerIds],
  );
  return result.rows.map((row) => row.id);
}

export async function findPlayerByTeamAndUser(
  teamId: string,
  userId: string,
): Promise<Player | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, evidence_url, jersey_number, position, is_captain, joined_at, left_at
     FROM players
     WHERE team_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [teamId, userId],
  );

  if (result.rowCount === 0) return null;
  return mapPlayer(result.rows[0]);
}

export async function findPlayerById(id: string): Promise<Player | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, evidence_url, jersey_number, position, is_captain, joined_at, left_at
     FROM players
     WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapPlayer(result.rows[0]);
}

export async function createPlayer(input: PlayerCreateInput): Promise<Player> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO players (team_id, user_id, full_name, birth_date, student_id, contact_email, evidence_url, jersey_number, position, is_captain)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id, team_id, user_id, full_name, birth_date, student_id, contact_email, evidence_url, jersey_number, position, is_captain, joined_at, left_at`,
    [
      input.teamId,
      input.userId ?? null,
      input.fullName,
      input.birthDate ?? null,
      input.studentId ?? null,
      input.contactEmail ?? null,
      input.evidenceUrl ?? null,
      input.jerseyNumber ?? null,
      input.position ?? null,
      input.isCaptain ?? false,
    ],
  );

  return mapPlayer(result.rows[0]);
}

export async function updatePlayer(id: string, input: PlayerUpdateInput): Promise<Player | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.fullName !== undefined) {
    sets.push(`full_name = $${idx++}`);
    values.push(input.fullName);
  }
  if (input.birthDate !== undefined) {
    sets.push(`birth_date = $${idx++}`);
    values.push(input.birthDate);
  }
  if (input.studentId !== undefined) {
    sets.push(`student_id = $${idx++}`);
    values.push(input.studentId);
  }
  if (input.contactEmail !== undefined) {
    sets.push(`contact_email = $${idx++}`);
    values.push(input.contactEmail);
  }
  if (input.evidenceUrl !== undefined) {
    sets.push(`evidence_url = $${idx++}`);
    values.push(input.evidenceUrl);
  }
  if (input.jerseyNumber !== undefined) {
    sets.push(`jersey_number = $${idx++}`);
    values.push(input.jerseyNumber);
  }
  if (input.position !== undefined) {
    sets.push(`position = $${idx++}`);
    values.push(input.position);
  }
  if (input.isCaptain !== undefined) {
    sets.push(`is_captain = $${idx++}`);
    values.push(input.isCaptain);
  }
  if (input.leftAt !== undefined) {
    sets.push(`left_at = $${idx++}`);
    values.push(input.leftAt);
  }

  if (sets.length === 0) {
    const existing = await pool.query(
      `SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, evidence_url, jersey_number, position, is_captain, joined_at, left_at
       FROM players WHERE id = $1`,
      [id],
    );
    if (existing.rowCount === 0) return null;
    return mapPlayer(existing.rows[0]);
  }

  values.push(id);

  await pool.query(
    `UPDATE players SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  const result = await pool.query(
    `SELECT id, team_id, user_id, full_name, birth_date, student_id, contact_email, evidence_url, jersey_number, position, is_captain, joined_at, left_at
     FROM players WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapPlayer(result.rows[0]);
}

export async function deletePlayer(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM players WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

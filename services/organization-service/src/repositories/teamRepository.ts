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
  registered_at: string;
  approved_at: string | null;
  approved_by: string | null;
  notes: string | null;
  institution_id?: string | null;
  institution_name?: string | null;
}): TeamRegistration {
  return {
    id: row.id,
    teamId: row.team_id,
    tournamentId: row.tournament_id,
    status: row.status as any,
    registeredAt: row.registered_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    notes: row.notes,
    institutionId: row.institution_id ?? null,
    ...(row.institution_name !== undefined ? { institutionName: row.institution_name } : {}),
  };
}

export async function findTeamRegistration(
  teamId: string,
  tournamentId: string,
): Promise<TeamRegistration | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.registered_at, tr.approved_at,
            tr.approved_by, tr.notes, COALESCE(tr.institution_id, t.institution_id) AS institution_id
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
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.registered_at, tr.approved_at,
            tr.approved_by, tr.notes, COALESCE(tr.institution_id, t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id = tr.team_id
     WHERE tr.team_id = $1 ORDER BY tr.registered_at DESC`,
    [teamId],
  );
  return result.rows.map(mapTeamRegistration);
}

export async function findTeamRegistrationById(id: string): Promise<TeamRegistration | null> {
  const result = await getPool().query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.registered_at, tr.approved_at,
            tr.approved_by, tr.notes, COALESCE(tr.institution_id, t.institution_id) AS institution_id
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
    SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.registered_at, tr.approved_at,
           tr.approved_by, tr.notes, COALESCE(tr.institution_id, t.institution_id) AS institution_id,
           i.name AS institution_name
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

  query += ` ORDER BY tr.registered_at DESC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapTeamRegistration);
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
            COUNT(*) FILTER (WHERE tr.status = 'PENDING')::text AS pending,
            COUNT(*) FILTER (WHERE tr.status = 'APPROVED')::text AS approved
     FROM team_registrations tr
     JOIN teams t ON t.id = tr.team_id
     WHERE tr.status IN ('PENDING', 'APPROVED')
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
  teamId: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  institutionId: string | null;
  institutionName: string | null;
  isActive: boolean;
  registrationStatus: string;
  verifiedRosterCount: number;
  totalRosterCount: number;
}>> {
  const result = await getPool().query<{
    team_id: string;
    name: string;
    short_name: string | null;
    logo_url: string | null;
    institution_id: string | null;
    institution_name: string | null;
    is_active: boolean;
    registration_status: string;
    verified_roster_count: number;
    total_roster_count: number;
  }>(
    `SELECT t.id AS team_id, t.name, t.short_name, t.logo_url, t.institution_id,
            t.is_active,
            i.name AS institution_name, tr.status AS registration_status,
            COUNT(r.id) FILTER (WHERE r.is_verified)::INTEGER AS verified_roster_count,
            COUNT(r.id)::INTEGER AS total_roster_count
     FROM team_registrations tr
     JOIN teams t ON t.id = tr.team_id
     LEFT JOIN institutions i ON i.id = t.institution_id
     LEFT JOIN rosters r ON r.team_id = tr.team_id AND r.tournament_id = tr.tournament_id
     WHERE tr.tournament_id = $1
     GROUP BY t.id, i.name, tr.status
     ORDER BY t.name`,
    [tournamentId],
  );
  return result.rows.map((row) => ({
    teamId: row.team_id,
    name: row.name,
    shortName: row.short_name,
    logoUrl: row.logo_url,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    isActive: row.is_active,
    registrationStatus: row.registration_status,
    verifiedRosterCount: row.verified_roster_count,
    totalRosterCount: row.total_roster_count,
  }));
}

export async function createTeamRegistration(
  input: TeamRegistrationCreateInput,
): Promise<TeamRegistration> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO team_registrations (id, team_id, tournament_id, institution_id, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, team_id, tournament_id, status, registered_at, approved_at, approved_by, notes, institution_id`,
    [input.id, input.teamId, input.tournamentId, input.institutionId, input.notes ?? null],
  );

  return mapTeamRegistration(result.rows[0]);
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

  if (input.status === "APPROVED" && approvedBy) {
    sets.push(`approved_at = NOW()`);
    sets.push(`approved_by = $${idx++}`);
    values.push(approvedBy);
  }

  if (sets.length === 0) {
    const existing = await pool.query(
      `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.registered_at, tr.approved_at,
              tr.approved_by, tr.notes, COALESCE(tr.institution_id, t.institution_id) AS institution_id
       FROM team_registrations tr JOIN teams t ON t.id = tr.team_id WHERE tr.id = $1`,
      [id],
    );
    if (existing.rowCount === 0) return null;
    return mapTeamRegistration(existing.rows[0]);
  }

  values.push(id);

  await pool.query(
    `UPDATE team_registrations SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  const result = await pool.query(
    `SELECT tr.id, tr.team_id, tr.tournament_id, tr.status, tr.registered_at, tr.approved_at,
            tr.approved_by, tr.notes, COALESCE(tr.institution_id, t.institution_id) AS institution_id
     FROM team_registrations tr JOIN teams t ON t.id = tr.team_id WHERE tr.id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapTeamRegistration(result.rows[0]);
}

export async function deleteTeamRegistration(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM team_registrations WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
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

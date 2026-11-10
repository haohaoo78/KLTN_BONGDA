import type {
  Season,
  SeasonCreateInput,
  RegulationVersion,
  RegulationVersionCreateInput,
  Group,
  GroupCreateInput,
  Draw,
  DrawCreateInput,
} from "../models/tournament";
import { getPool } from "../lib/db";

// Seasons
function mapSeason(row: {
  id: string;
  name: string;
  year: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): Season {
  return {
    id: row.id,
    name: row.name,
    year: row.year,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listSeasons(isActive?: boolean): Promise<Season[]> {
  const pool = getPool();
  let query = `SELECT id, name, year, description, is_active, created_at, updated_at FROM seasons`;
  const params: unknown[] = [];

  if (isActive !== undefined) {
    query += ` WHERE is_active = $1`;
    params.push(isActive);
  }

  query += ` ORDER BY year DESC, name ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapSeason);
}

export async function createSeason(input: SeasonCreateInput): Promise<Season> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO seasons (name, year, description) VALUES ($1, $2, $3)
     RETURNING id, name, year, description, is_active, created_at, updated_at`,
    [input.name, input.year, input.description ?? null],
  );
  return mapSeason(result.rows[0]);
}

export async function updateSeason(id: string, isActive: boolean): Promise<Season | null> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE seasons SET is_active = $1, updated_at = NOW() WHERE id = $2
     RETURNING id, name, year, description, is_active, created_at, updated_at`,
    [isActive, id],
  );
  if (result.rowCount === 0) return null;
  return mapSeason(result.rows[0]);
}

// Regulation Versions
function mapRegulationVersion(row: {
  id: string;
  tournament_id: string;
  version: number;
  title: string;
  content: string;
  effective_date: string;
  created_by: string;
  created_at: string;
}): RegulationVersion {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    version: row.version,
    title: row.title,
    content: row.content,
    effectiveDate: row.effective_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listRegulationVersions(tournamentId: string): Promise<RegulationVersion[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, version, title, content, effective_date, created_by, created_at
     FROM regulation_versions
     WHERE tournament_id = $1
     ORDER BY version DESC`,
    [tournamentId],
  );
  return result.rows.map(mapRegulationVersion);
}

export async function createRegulationVersion(input: RegulationVersionCreateInput, createdBy: string): Promise<RegulationVersion> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO regulation_versions (tournament_id, version, title, content, effective_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tournament_id, version, title, content, effective_date, created_by, created_at`,
    [
      input.tournamentId,
      input.version,
      input.title,
      input.content,
      input.effectiveDate,
      createdBy,
    ],
  );
  return mapRegulationVersion(result.rows[0]);
}

// Groups
function mapGroup(row: {
  id: string;
  tournament_id: string;
  name: string;
  stage: string;
  max_teams: number;
  created_at: string;
}): Group {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    name: row.name,
    stage: row.stage as any,
    maxTeams: row.max_teams,
    createdAt: row.created_at,
  };
}

export async function listGroups(tournamentId: string): Promise<Group[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, name, stage, max_teams, created_at
     FROM groups
     WHERE tournament_id = $1
     ORDER BY stage, name`,
    [tournamentId],
  );
  return result.rows.map(mapGroup);
}

export async function createGroup(input: GroupCreateInput): Promise<Group> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO groups (tournament_id, name, stage, max_teams) VALUES ($1, $2, $3, $4)
     RETURNING id, tournament_id, name, stage, max_teams, created_at`,
    [input.tournamentId, input.name, input.stage, input.maxTeams],
  );
  return mapGroup(result.rows[0]);
}

// Draws
function mapDraw(row: {
  id: string;
  tournament_id: string;
  group_id: string | null;
  team_id: string;
  position: number;
  drawn_at: string;
  drawn_by: string;
}): Draw {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    groupId: row.group_id,
    teamId: row.team_id,
    position: row.position,
    drawnAt: row.drawn_at,
    drawnBy: row.drawn_by,
  };
}

export async function listDraws(tournamentId: string, groupId?: string): Promise<Draw[]> {
  const pool = getPool();
  let query = `SELECT id, tournament_id, group_id, team_id, position, drawn_at, drawn_by FROM draws WHERE tournament_id = $1`;
  const params: unknown[] = [tournamentId];

  if (groupId) {
    query += ` AND group_id = $2`;
    params.push(groupId);
  }

  query += ` ORDER BY group_id, position`;

  const result = await pool.query(query, params);
  return result.rows.map(mapDraw);
}

export async function createDraw(input: DrawCreateInput, drawnBy: string): Promise<Draw> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO draws (tournament_id, group_id, team_id, position, drawn_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, tournament_id, group_id, team_id, position, drawn_at, drawn_by`,
    [input.tournamentId, input.groupId ?? null, input.teamId, input.position, drawnBy],
  );
  return mapDraw(result.rows[0]);
}

export async function deleteDraws(tournamentId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`DELETE FROM draws WHERE tournament_id = $1`, [tournamentId]);
}

import type {
  Venue,
  VenueCreateInput,
  VenueUpdateInput,
  VenueAvailability,
  VenueAvailabilityCreateInput,
  Schedule,
  ScheduleCreateInput,
  ScheduleUpdateInput,
} from "../models/scheduling";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";

// Venues
function mapVenue(row: {
  id: string;
  name: string;
  location: string;
  capacity: number | null;
  surface: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): Venue {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    capacity: row.capacity,
    surface: row.surface,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findVenueById(id: string): Promise<Venue | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, name, location, capacity, surface, is_active, created_at, updated_at
     FROM venues
     WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapVenue(result.rows[0]);
}

export async function listVenues(isActive?: boolean): Promise<Venue[]> {
  const pool = getPool();
  let query = `
    SELECT id, name, location, capacity, surface, is_active, created_at, updated_at
    FROM venues
  `;
  const params: unknown[] = [];

  if (isActive !== undefined) {
    query += ` WHERE is_active = $1`;
    params.push(isActive);
  }

  query += ` ORDER BY name ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapVenue);
}

export async function createVenue(input: VenueCreateInput): Promise<Venue> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO venues (name, location, capacity, surface)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, location, capacity, surface, is_active, created_at, updated_at`,
    [input.name, input.location, input.capacity ?? null, input.surface ?? null],
  );

  return mapVenue(result.rows[0]);
}

export async function updateVenue(id: string, input: VenueUpdateInput): Promise<Venue | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.location !== undefined) {
    sets.push(`location = $${idx++}`);
    values.push(input.location);
  }
  if (input.capacity !== undefined) {
    sets.push(`capacity = $${idx++}`);
    values.push(input.capacity);
  }
  if (input.surface !== undefined) {
    sets.push(`surface = $${idx++}`);
    values.push(input.surface);
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx++}`);
    values.push(input.isActive);
  }

  if (sets.length === 0) {
    return findVenueById(id);
  }

  sets.push("updated_at = NOW()");
  values.push(id);

  await pool.query(
    `UPDATE venues SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  return findVenueById(id);
}

export async function deleteVenue(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM venues WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// Venue Availability
function mapVenueAvailability(row: {
  id: string;
  venue_id: string;
  available_from: string;
  available_to: string;
  reason: string | null;
  created_at: string;
}): VenueAvailability {
  return {
    id: row.id,
    venueId: row.venue_id,
    availableFrom: row.available_from,
    availableTo: row.available_to,
    reason: row.reason,
    createdAt: row.created_at,
  };
}

export async function listVenueAvailability(venueId: string): Promise<VenueAvailability[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, venue_id, available_from, available_to, reason, created_at
     FROM venue_availability
     WHERE venue_id = $1
     ORDER BY available_from ASC`,
    [venueId],
  );

  return result.rows.map(mapVenueAvailability);
}

export async function isVenueAvailableDuring(
  venueId: string,
  start: Date,
  end: Date,
): Promise<boolean> {
  const result = await getPool().query<{ has_windows: boolean; fits_window: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM venue_availability WHERE venue_id = $1
     ) AS has_windows,
     EXISTS(
       SELECT 1 FROM venue_availability
       WHERE venue_id = $1 AND available_from <= $2 AND available_to >= $3
     ) AS fits_window`,
    [venueId, start, end],
  );
  const row = result.rows[0];
  return !row.has_windows || row.fits_window;
}

export async function createVenueAvailability(input: VenueAvailabilityCreateInput): Promise<VenueAvailability> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO venue_availability (venue_id, available_from, available_to, reason)
     VALUES ($1, $2, $3, $4)
     RETURNING id, venue_id, available_from, available_to, reason, created_at`,
    [input.venueId, input.availableFrom, input.availableTo, input.reason ?? null],
  );

  return mapVenueAvailability(result.rows[0]);
}

export async function deleteVenueAvailability(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM venue_availability WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// Schedules
function mapSchedule(row: {
  id: string;
  tournament_id: string;
  match_id: string;
  venue_id: string;
  referee_id: string | null;
  scheduled_date: string;
  duration_minutes: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}): Schedule {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    matchId: row.match_id,
    venueId: row.venue_id,
    refereeId: row.referee_id,
    scheduledDate: row.scheduled_date,
    durationMinutes: row.duration_minutes,
    status: row.status as any,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findScheduleById(id: string): Promise<Schedule | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, created_by, created_at, updated_at
     FROM schedules
     WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapSchedule(result.rows[0]);
}

export async function listSchedules(
  tournamentId: string,
  status?: string,
): Promise<Schedule[]> {
  const pool = getPool();
  let query = `
    SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, created_by, created_at, updated_at
    FROM schedules
    WHERE tournament_id = $1
  `;
  const params: unknown[] = [tournamentId];

  if (status) {
    query += ` AND status = $2`;
    params.push(status);
  }

  query += ` ORDER BY scheduled_date ASC`;

  const result = await pool.query(query, params);
  return result.rows.map(mapSchedule);
}

export async function listSchedulesByReferee(refereeId: string): Promise<Schedule[]> {
  const result = await getPool().query(
    `SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date,
            duration_minutes, status, created_by, created_at, updated_at
     FROM schedules
     WHERE referee_id = $1 AND status != 'CANCELLED'
     ORDER BY scheduled_date ASC`,
    [refereeId],
  );
  return result.rows.map(mapSchedule);
}

export async function isRefereeAssignedToMatch(
  matchId: string,
  refereeId: string,
): Promise<boolean> {
  const result = await getPool().query(
    `SELECT 1 FROM schedules
     WHERE match_id = $1 AND referee_id = $2 AND status != 'CANCELLED'
     LIMIT 1`,
    [matchId, refereeId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findScheduleByMatchId(matchId: string): Promise<Schedule | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, created_by, created_at, updated_at
     FROM schedules
     WHERE match_id = $1 AND status != 'CANCELLED'
     ORDER BY created_at DESC
     LIMIT 1`,
    [matchId],
  );

  if (result.rowCount === 0) return null;
  return mapSchedule(result.rows[0]);
}

export async function createSchedule(input: ScheduleCreateInput, createdBy: string): Promise<Schedule> {
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO schedules (tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, created_by, created_at, updated_at`,
    [
      input.tournamentId,
      input.matchId,
      input.venueId,
      input.refereeId ?? null,
      input.scheduledDate,
      input.durationMinutes ?? 90,
      createdBy,
    ],
  );

  return mapSchedule(result.rows[0]);
}

export async function updateSchedule(id: string, input: ScheduleUpdateInput): Promise<Schedule | null> {
  const pool = getPool();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.venueId !== undefined) {
    sets.push(`venue_id = $${idx++}`);
    values.push(input.venueId);
  }
  if (input.refereeId !== undefined) {
    sets.push(`referee_id = $${idx++}`);
    values.push(input.refereeId);
  }
  if (input.scheduledDate !== undefined) {
    sets.push(`scheduled_date = $${idx++}`);
    values.push(input.scheduledDate);
  }
  if (input.durationMinutes !== undefined) {
    sets.push(`duration_minutes = $${idx++}`);
    values.push(input.durationMinutes);
  }
  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }

  if (sets.length === 0) {
    return findScheduleById(id);
  }

  sets.push("updated_at = NOW()");
  values.push(id);

  await pool.query(
    `UPDATE schedules SET ${sets.join(", ")} WHERE id = $${idx}`,
    values,
  );

  return findScheduleById(id);
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query("DELETE FROM schedules WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

// Conflict checking
export async function checkVenueConflicts(
  venueId: string,
  scheduledDate: string,
  durationMinutes: number,
  excludeScheduleId?: string,
): Promise<Schedule[]> {
  const pool = getPool();
  const startTime = new Date(scheduledDate);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

  let query = `
    SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, created_by, created_at, updated_at
    FROM schedules
    WHERE venue_id = $1
      AND status != 'CANCELLED'
      AND scheduled_date < $2
      AND (scheduled_date + (duration_minutes * INTERVAL '1 minute')) > $3
  `;
  const params: unknown[] = [venueId, endTime, startTime];

  if (excludeScheduleId) {
    query += ` AND id != $4`;
    params.push(excludeScheduleId);
  }

  const result = await pool.query(query, params);
  return result.rows.map(mapSchedule);
}

export async function checkRefereeConflicts(
  refereeId: string,
  scheduledDate: string,
  durationMinutes: number,
  excludeScheduleId?: string,
): Promise<Schedule[]> {
  const pool = getPool();
  const startTime = new Date(scheduledDate);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

  let query = `
    SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, created_by, created_at, updated_at
    FROM schedules
    WHERE referee_id = $1
      AND status != 'CANCELLED'
      AND scheduled_date < $2
      AND (scheduled_date + (duration_minutes * INTERVAL '1 minute')) > $3
  `;
  const params: unknown[] = [refereeId, endTime, startTime];

  if (excludeScheduleId) {
    query += ` AND id != $4`;
    params.push(excludeScheduleId);
  }

  const result = await pool.query(query, params);
  return result.rows.map(mapSchedule);
}

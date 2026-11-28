import type {
  Venue,
  VenueCreateInput,
  VenueUpdateInput,
  VenueAvailability,
  VenueAvailabilityCreateInput,
  Schedule,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ScheduleChangeHistory,
  ScheduleRefereeAssignment,
  ScheduleRefereeAssignmentInput,
  ScheduleRefereeAssignmentHistory,
} from "../models/scheduling";
import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import { publishCommittedMatchUpdate } from "../../realtime/matchRealtime";
import { assertConfiguredCrew, lockRefereeConfiguration } from "./refereeConfigurationRepository";
import { assertDraftReservationsForSchedule } from "./refereeAssignmentRepository";
import { getPool as getMatchPool } from "../../lib/db";

async function assertScheduleMatchMutable(matchId: string): Promise<void> {
  const match = (await getMatchPool().query("SELECT status FROM matches WHERE id=$1", [matchId])).rows[0];
  if (!match || !["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(match.status)) throw new AppError(409, "Trận đã được xác nhận sẵn sàng hoặc bắt đầu tác nghiệp; không thay lịch/phân công qua luồng thông thường.", "MATCH_OPERATION_SCHEDULE_LOCKED");
}

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
export function mapSchedule(row: {
  operation_status?: string | null;
  id: string;
  tournament_id: string;
  match_id: string;
  venue_id: string;
  referee_id: string | null;
  assigned_position?: string | null;
  assigned_final_authority?: boolean | null;
  scheduled_date: string;
  duration_minutes: number;
  status: string;
  is_locked?: boolean;
  notes?: string;
  slot_id?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}): Schedule {
  return {
    operationStatus: row.operation_status ?? null,
    id: row.id,
    tournamentId: row.tournament_id,
    matchId: row.match_id,
    venueId: row.venue_id,
    refereeId: row.referee_id,
    ...(row.assigned_position ? { myAssignment: { position: row.assigned_position, isFinalAuthority: row.assigned_final_authority === true } } : {}),
    scheduledDate: new Date(row.scheduled_date).toISOString(),
    durationMinutes: row.duration_minutes,
    status: row.status as any,
    isLocked: row.is_locked === true,
    notes: row.notes ?? "",
    slotId: row.slot_id ?? null,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export async function findScheduleById(id: string): Promise<Schedule | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, is_locked, notes, slot_id, created_by, created_at, updated_at
     FROM schedules
     WHERE id = $1`,
    [id],
  );

  if (result.rowCount === 0) return null;
  return mapSchedule(result.rows[0]);
}

export async function setScheduleLock(id: string, isLocked: boolean): Promise<Schedule | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ match_id: string; status: string }>(
      "SELECT match_id, status FROM schedules WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!current.rowCount) { await client.query("COMMIT"); return null; }
    if (current.rows[0].status !== "DRAFT") {
      throw new AppError(409, "Chỉ được khóa hoặc mở khóa lịch nháp chưa công bố", "SCHEDULE_LOCK_STATE_RESTRICTED");
    }
    await client.query("UPDATE schedules SET is_locked=$2, updated_at=NOW() WHERE id=$1", [id, isLocked]);
    await client.query("COMMIT");
    await publishCommittedMatchUpdate(current.rows[0].match_id, isLocked ? "schedule.locked" : "schedule.unlocked");
    return findScheduleById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export type TournamentScheduleResourcesRecord = {
  tournamentId: string;
  resources: Record<string, unknown>;
  revision: number;
  updatedAt: string;
};

export async function getTournamentScheduleResources(tournamentId: string): Promise<TournamentScheduleResourcesRecord | null> {
  const result = await getPool().query<{ resources: Record<string, unknown>; revision: string; updated_at: Date }>(
    "SELECT resources, revision, updated_at FROM tournament_schedule_resources WHERE tournament_id=$1",
    [tournamentId],
  );
  const row = result.rows[0];
  return row ? { tournamentId, resources: row.resources, revision: Number(row.revision), updatedAt: row.updated_at.toISOString() } : null;
}

export async function saveTournamentScheduleResources(
  tournamentId: string,
  resources: Record<string, unknown>,
  updatedBy: string,
  expectedRevision: number | null,
  assertCurrent?: () => Promise<void>,
): Promise<TournamentScheduleResourcesRecord | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('official-schedule-resources:' || $1)::bigint)", [tournamentId]);
    const current = await client.query<{ revision: string }>(
      "SELECT revision FROM tournament_schedule_resources WHERE tournament_id=$1 FOR UPDATE",
      [tournamentId],
    );
    const currentRevision = current.rows[0] ? Number(current.rows[0].revision) : null;
    if (currentRevision !== expectedRevision) { await client.query("ROLLBACK"); return null; }
    if (assertCurrent) await assertCurrent();
    const saved = await client.query<{ resources: Record<string, unknown>; revision: string; updated_at: Date }>(
      `INSERT INTO tournament_schedule_resources (tournament_id,resources,revision,updated_by)
       VALUES ($1,$2::jsonb,1,$3)
       ON CONFLICT (tournament_id) DO UPDATE SET resources=EXCLUDED.resources,
         revision=tournament_schedule_resources.revision+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING resources,revision,updated_at`,
      [tournamentId, JSON.stringify(resources), updatedBy],
    );
    await client.query("COMMIT");
    const row = saved.rows[0];
    return { tournamentId, resources: row.resources, revision: Number(row.revision), updatedAt: row.updated_at.toISOString() };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function listSchedules(
  tournamentId: string,
  status?: string,
): Promise<Schedule[]> {
  const pool = getPool();
  let query = `
    SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, is_locked, notes, slot_id, created_by, created_at, updated_at
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
    `SELECT schedule.id, schedule.tournament_id, schedule.match_id, schedule.venue_id, schedule.referee_id, schedule.scheduled_date,
            schedule.duration_minutes, schedule.status, schedule.is_locked, schedule.notes, schedule.slot_id, schedule.created_by, schedule.created_at, schedule.updated_at,
            assignment.position AS assigned_position, assignment.is_final_authority AS assigned_final_authority
     FROM schedules schedule
     LEFT JOIN LATERAL (
       SELECT position, is_final_authority FROM schedule_referee_assignments
       WHERE schedule_id = schedule.id AND referee_id = $1 AND is_active = TRUE LIMIT 1
     ) assignment ON TRUE
     LEFT JOIN LATERAL (SELECT schedule_id,slots,voided_at FROM schedule_referee_publications WHERE schedule_id=schedule.id ORDER BY revision DESC LIMIT 1) publication ON TRUE
     WHERE ((schedule.referee_id = $1 AND publication.schedule_id IS NULL AND NOT EXISTS(SELECT 1 FROM schedule_referee_assignments active WHERE active.schedule_id=schedule.id AND active.is_active=TRUE)) OR EXISTS (
       SELECT 1 FROM schedule_referee_assignments assignment
       WHERE assignment.schedule_id = schedule.id AND assignment.referee_id = $1 AND assignment.is_active = TRUE
         AND (publication.schedule_id IS NULL OR (publication.voided_at IS NULL AND publication.slots @> jsonb_build_array(jsonb_build_object('refereeId',$1::text,'position',assignment.position))))
     )) AND schedule.status = 'PUBLISHED'
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
     WHERE match_id = $1 AND status = 'PUBLISHED'
       AND (referee_id = $2 OR EXISTS (
         SELECT 1 FROM schedule_referee_assignments assignment
         WHERE assignment.schedule_id = schedules.id AND assignment.referee_id = $2 AND assignment.is_active = TRUE
       ))
     LIMIT 1`,
    [matchId, refereeId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function findRefereeAssignmentForMatch(matchId: string, refereeId: string): Promise<ScheduleRefereeAssignment | null> {
  const result = await getPool().query(
    `SELECT assignment.id, assignment.schedule_id, assignment.referee_id, assignment.position,
            assignment.is_final_authority, assignment.assigned_by, assignment.assigned_at
     FROM schedules schedule
     JOIN schedule_referee_assignments assignment ON assignment.schedule_id = schedule.id
     WHERE schedule.match_id = $1 AND schedule.status = 'PUBLISHED'
       AND assignment.referee_id = $2 AND assignment.is_active = TRUE
     ORDER BY assignment.is_final_authority DESC LIMIT 1`,
    [matchId, refereeId],
  );
  return result.rowCount ? mapRefereeAssignment(result.rows[0]) : null;
}

function mapRefereeAssignment(row: {
  id: string;
  schedule_id: string;
  referee_id: string;
  position: string;
  is_final_authority: boolean;
  assigned_by: string;
  assigned_at: string;
}): ScheduleRefereeAssignment {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    refereeId: row.referee_id,
    position: row.position,
    isFinalAuthority: row.is_final_authority,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
  };
}

export async function listScheduleRefereeAssignments(scheduleId: string): Promise<ScheduleRefereeAssignment[]> {
  const result = await getPool().query(
    `SELECT id, schedule_id, referee_id, position, is_final_authority, assigned_by, assigned_at
     FROM schedule_referee_assignments
     WHERE schedule_id = $1 AND is_active = TRUE
     ORDER BY is_final_authority DESC, position ASC`,
    [scheduleId],
  );
  return result.rows.map(mapRefereeAssignment);
}

export async function replaceScheduleRefereeAssignments(
  scheduleId: string,
  assignments: ScheduleRefereeAssignmentInput[],
  changedBy: string,
  reason?: string,
): Promise<ScheduleRefereeAssignment[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scope = await client.query<{ tournament_id: string }>("SELECT tournament_id FROM schedules WHERE id=$1", [scheduleId]);
    if (!scope.rowCount) throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
    await lockRefereeConfiguration(client, scope.rows[0].tournament_id);
    const schedule = await client.query<{ referee_id: string | null; match_id: string }>(
      "SELECT referee_id, match_id FROM schedules WHERE id = $1 FOR UPDATE",
      [scheduleId],
    );
    if (!schedule.rowCount) throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
    await assertScheduleMatchMutable(schedule.rows[0].match_id);
    await assertConfiguredCrew(client, scope.rows[0].tournament_id, schedule.rows[0].match_id, assignments);
    const refereeIds = assignments.map((assignment) => assignment.refereeId).sort();
    for (const refereeId of refereeIds) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [refereeId]);
    }
    const draft = await client.query("SELECT 1 FROM schedule_referee_drafts WHERE schedule_id=$1", [scheduleId]);
    if (draft.rowCount) throw new AppError(409, "Trận đang có bản nháp phân công; sử dụng luồng bản nháp, không ghi đè bằng API tổ trọng tài cũ.", "REFEREE_DRAFT_ENDPOINT_REQUIRED");
    await assertDraftReservationsForSchedule(client, scheduleId, refereeIds);
    if (refereeIds.length) {
      const conflicts = await client.query(
        `SELECT other.id, COALESCE(other.referee_id, assignment.referee_id) AS referee_id
         FROM schedules other
         LEFT JOIN schedule_referee_assignments assignment
           ON assignment.schedule_id = other.id AND assignment.is_active = TRUE
         WHERE other.id <> $1 AND other.status <> 'CANCELLED'
           AND other.scheduled_date < (
             SELECT current.scheduled_date + current.duration_minutes * INTERVAL '1 minute'
             FROM schedules current WHERE current.id = $1
           )
           AND other.scheduled_date + other.duration_minutes * INTERVAL '1 minute' > (
             SELECT current.scheduled_date FROM schedules current WHERE current.id = $1
           )
           AND (other.referee_id = ANY($2::uuid[]) OR assignment.referee_id = ANY($2::uuid[]))
         LIMIT 1`,
        [scheduleId, refereeIds],
      );
      if (conflicts.rowCount) {
        throw new AppError(409, `Referee ${conflicts.rows[0].referee_id} is already assigned to an overlapping match`, "REFEREE_CONFLICT");
      }
    }
    const before = await client.query(
      `SELECT referee_id AS "refereeId", position, is_final_authority AS "isFinalAuthority"
       FROM schedule_referee_assignments WHERE schedule_id = $1 AND is_active = TRUE ORDER BY position`,
      [scheduleId],
    );
    await client.query(
      `INSERT INTO schedule_referee_assignment_history (schedule_id, before_assignments, after_assignments, changed_by, reason)
       VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
      [scheduleId, JSON.stringify(before.rows), JSON.stringify(assignments), changedBy, reason ?? null],
    );
    await client.query(
      "UPDATE schedule_referee_assignments SET is_active = FALSE, updated_at = NOW() WHERE schedule_id = $1 AND is_active = TRUE",
      [scheduleId],
    );
    for (const assignment of assignments) {
      await client.query(
        `INSERT INTO schedule_referee_assignments (schedule_id, referee_id, position, is_final_authority, assigned_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [scheduleId, assignment.refereeId, assignment.position, assignment.isFinalAuthority === true, changedBy],
      );
    }
    const finalRefereeId = assignments.find((assignment) => assignment.isFinalAuthority)?.refereeId ?? null;
    await client.query("UPDATE schedules SET referee_id = $2, updated_at = NOW() WHERE id = $1", [scheduleId, finalRefereeId]);
    const result = await client.query(
      `SELECT id, schedule_id, referee_id, position, is_final_authority, assigned_by, assigned_at
       FROM schedule_referee_assignments WHERE schedule_id = $1 AND is_active = TRUE
       ORDER BY is_final_authority DESC, position ASC`,
      [scheduleId],
    );
    await client.query("COMMIT");
    await publishCommittedMatchUpdate(schedule.rows[0].match_id, "schedule.referees.updated");
    return result.rows.map(mapRefereeAssignment);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listScheduleRefereeAssignmentHistory(scheduleId: string): Promise<ScheduleRefereeAssignmentHistory[]> {
  const result = await getPool().query(
    `SELECT id,
       before_assignments, after_assignments,
       changed_by, reason, changed_at
     FROM schedule_referee_assignment_history
     WHERE schedule_id = $1 ORDER BY changed_at DESC LIMIT 50`,
    [scheduleId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    beforeAssignments: row.before_assignments,
    afterAssignments: row.after_assignments,
    changedBy: row.changed_by,
    reason: row.reason,
    changedAt: row.changed_at,
  }));
}

export async function findScheduleByMatchId(matchId: string): Promise<Schedule | null> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, is_locked, notes, slot_id, created_by, created_at, updated_at
     FROM schedules
     WHERE match_id = $1 AND status != 'CANCELLED'
     ORDER BY created_at DESC
     LIMIT 1`,
    [matchId],
  );

  if (result.rowCount === 0) return null;
  return mapSchedule(result.rows[0]);
}

type ScheduleConflictGuard = {
  teamIds: string[];
  refereeIds: string[];
  minimumRestMinutes: number;
};

async function lockScheduleResources(
  client: import("pg").PoolClient,
  resourceIds: string[],
): Promise<void> {
  for (const resourceId of [...new Set(resourceIds)].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [resourceId]);
  }
}

/** Commit an entire proposal together; cancelled drafts remain available in change history. */
export async function saveScheduleDraftBatch(
  tournamentId: string,
  inputs: ScheduleCreateInput[],
  changedBy: string,
  teamIds: string[],
  assertCurrent: () => Promise<void>,
): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('official-schedule-resources:' || $1)::bigint)", [tournamentId]);
    const current = await client.query("SELECT * FROM schedules WHERE tournament_id=$1 AND status <> 'CANCELLED' ORDER BY id FOR UPDATE", [tournamentId]);
    await lockScheduleResources(client, [...inputs.flatMap((input) => [input.venueId, input.matchId]), ...current.rows.map((row) => row.venue_id), ...teamIds]);
    await assertCurrent();
    const nextByMatch = new Map(inputs.map((input) => [input.matchId, input]));
    for (const row of current.rows) {
      const next = nextByMatch.get(row.match_id);
      const unchanged = next && next.venueId === row.venue_id && new Date(next.scheduledDate).getTime() === new Date(row.scheduled_date).getTime() && next.durationMinutes === row.duration_minutes;
      if (row.is_locked || row.status !== "DRAFT") {
        if (!unchanged) throw new AppError(409, `Trận ${row.match_id} đã khóa hoặc đã công bố`, "SCHEDULE_LOCKED");
      }
    }
    // Exclude this proposal's existing rows while checking the complete next plan.
    const external = await client.query("SELECT id, venue_id, scheduled_date, duration_minutes FROM schedules WHERE tournament_id <> $1 AND status <> 'CANCELLED' AND venue_id=ANY($2::uuid[])", [tournamentId, [...new Set(inputs.map((input) => input.venueId))]]);
    for (const input of inputs) {
      const start = new Date(input.scheduledDate).getTime();
      const end = start + (input.durationMinutes ?? 90) * 60_000;
      const conflict = external.rows.find((row) => row.venue_id === input.venueId && new Date(row.scheduled_date).getTime() < end && new Date(row.scheduled_date).getTime() + row.duration_minutes * 60_000 > start);
      if (conflict) throw new AppError(409, "Sân đã có lịch của giải khác trong thời gian này", "VENUE_CONFLICT", { scheduleId: conflict.id, matchId: input.matchId });
    }
    for (const row of current.rows) {
      if (row.status !== "DRAFT") continue;
      const input = nextByMatch.get(row.match_id);
      const before = { venueId: row.venue_id, scheduledDate: new Date(row.scheduled_date).toISOString(), durationMinutes: row.duration_minutes, status: row.status, isLocked: row.is_locked, notes: row.notes ?? "", slotId: row.slot_id ?? null };
      const after = input ? { venueId: input.venueId, scheduledDate: new Date(input.scheduledDate).toISOString(), durationMinutes: input.durationMinutes ?? 90, status: "DRAFT", isLocked: input.locked ?? row.is_locked, notes: input.notes ?? "", slotId: input.slotId ?? null } : { ...before, status: "CANCELLED" };
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      await client.query("UPDATE schedules SET venue_id=$2,scheduled_date=$3,duration_minutes=$4,status=$5,is_locked=$6,notes=$7,slot_id=$8,updated_at=NOW() WHERE id=$1", [row.id, after.venueId, after.scheduledDate, after.durationMinutes, after.status, after.isLocked, after.notes, after.slotId]);
      await client.query("INSERT INTO schedule_change_history(schedule_id,before_state,after_state,changed_by,reason) VALUES($1,$2::jsonb,$3::jsonb,$4,$5)", [row.id, JSON.stringify(before), JSON.stringify(after), changedBy, input ? "BTC lưu phương án lịch nháp" : "BTC bỏ lịch khỏi phương án nháp"]);
    }
    for (const input of inputs) {
      if (current.rows.some((row) => row.match_id === input.matchId)) continue;
      await client.query("INSERT INTO schedules(tournament_id,match_id,venue_id,scheduled_date,duration_minutes,created_by,is_locked,notes,slot_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [tournamentId, input.matchId, input.venueId, input.scheduledDate, input.durationMinutes ?? 90, changedBy, input.locked ?? false, input.notes ?? "", input.slotId ?? null]);
    }
    await client.query("COMMIT");
    await Promise.all(inputs.map((input) => publishCommittedMatchUpdate(input.matchId, "schedule.draft.saved")));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** No caller can observe a tournament with only a subset of its draft rows published. */
export async function publishScheduleBatch(
  tournamentId: string,
  matchIds: string[],
  changedBy: string,
  teamIds: string[],
  assertCurrent: () => Promise<void>,
): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('official-schedule-resources:' || $1)::bigint)", [tournamentId]);
    const current = await client.query("SELECT * FROM schedules WHERE tournament_id=$1 AND status <> 'CANCELLED' ORDER BY id FOR UPDATE", [tournamentId]);
    await lockScheduleResources(client, [...current.rows.flatMap((row) => [row.venue_id, row.match_id]), ...teamIds]);
    await assertCurrent();
    if (matchIds.some((id) => !current.rows.some((row) => row.match_id === id && ["DRAFT", "PUBLISHED"].includes(row.status)))) throw new AppError(409, "Lịch chưa đầy đủ hoặc trạng thái đã thay đổi", "SCHEDULE_FIXTURES_UNSCHEDULED");
    let publishedCount = 0;
    for (const row of current.rows.filter((item) => matchIds.includes(item.match_id) && item.status === "DRAFT")) {
      const before = { venueId: row.venue_id, scheduledDate: new Date(row.scheduled_date).toISOString(), durationMinutes: row.duration_minutes, status: "DRAFT" };
      await client.query("UPDATE schedules SET status='PUBLISHED',updated_at=NOW() WHERE id=$1", [row.id]);
      await client.query("INSERT INTO schedule_change_history(schedule_id,before_state,after_state,changed_by,reason) VALUES($1,$2::jsonb,$3::jsonb,$4,$5)", [row.id, JSON.stringify(before), JSON.stringify({ ...before, status: "PUBLISHED" }), changedBy, "BTC công bố toàn bộ lịch thi đấu"]);
      publishedCount += 1;
    }
    await client.query("COMMIT");
    await Promise.all(matchIds.map((matchId) => publishCommittedMatchUpdate(matchId, "schedule.published")));
    return publishedCount;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function assertNoScheduleConflicts(
  client: import("pg").PoolClient,
  input: ScheduleCreateInput,
  guard: ScheduleConflictGuard,
  excludeScheduleId?: string,
): Promise<void> {
  const start = new Date(input.scheduledDate);
  const end = new Date(start.getTime() + (input.durationMinutes ?? 90) * 60_000);
  const excludeId = excludeScheduleId ?? null;

  const venueConflict = await client.query(
    `SELECT 1 FROM schedules
     WHERE venue_id = $1 AND status <> 'CANCELLED'
       AND ($4::uuid IS NULL OR id <> $4)
       AND scheduled_date < $2
       AND scheduled_date + duration_minutes * INTERVAL '1 minute' > $3
     LIMIT 1`,
    [input.venueId, end, start, excludeId],
  );
  if (venueConflict.rowCount) {
    throw new AppError(409, "The venue is already booked for that time", "VENUE_CONFLICT");
  }

  const matchConflict = await client.query(
    `SELECT 1 FROM schedules
     WHERE match_id = $1 AND status <> 'CANCELLED'
       AND ($2::uuid IS NULL OR id <> $2)
     LIMIT 1`,
    [input.matchId, excludeId],
  );
  if (matchConflict.rowCount) {
    throw new AppError(409, "A non-cancelled schedule already exists for this match", "SCHEDULE_ALREADY_EXISTS");
  }

  if (guard.refereeIds.length) {
    const refereeConflict = await client.query(
      `SELECT 1 FROM schedules schedule
       WHERE schedule.status <> 'CANCELLED'
         AND ($4::uuid IS NULL OR schedule.id <> $4)
         AND schedule.scheduled_date < $2
         AND schedule.scheduled_date + schedule.duration_minutes * INTERVAL '1 minute' > $3
         AND (schedule.referee_id = ANY($1::uuid[]) OR EXISTS (
           SELECT 1 FROM schedule_referee_assignments assignment
           WHERE assignment.schedule_id = schedule.id
             AND assignment.referee_id = ANY($1::uuid[]) AND assignment.is_active = TRUE
         ))
       LIMIT 1`,
      [guard.refereeIds, end, start, excludeId],
    );
    if (refereeConflict.rowCount) {
      throw new AppError(409, "An assigned official is already booked for that time", "REFEREE_CONFLICT");
    }
  }

}

export async function createSchedule(
  input: ScheduleCreateInput,
  createdBy: string,
  guard: ScheduleConflictGuard,
  validateTeamRest: () => Promise<void>,
): Promise<Schedule> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.refereeId) {
      await lockRefereeConfiguration(client, input.tournamentId);
      await assertConfiguredCrew(client, input.tournamentId, input.matchId, [{ refereeId: input.refereeId, position: "REFEREE", isFinalAuthority: true }]);
    }
    await lockScheduleResources(client, [
      input.venueId,
      input.matchId,
      ...guard.teamIds,
      ...guard.refereeIds,
    ]);
    await assertNoScheduleConflicts(client, input, guard);
    if (input.refereeId) await assertDraftReservationsForSchedule(client, null, [input.refereeId], { ...input, durationMinutes: input.durationMinutes ?? 90 });
    await validateTeamRest();
    const result = await client.query(
      `INSERT INTO schedules (tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, is_locked, notes, slot_id, created_by, created_at, updated_at`,
      [input.tournamentId, input.matchId, input.venueId, input.refereeId ?? null,
        input.scheduledDate, input.durationMinutes ?? 90, createdBy],
    );
    if (input.refereeId) {
      await client.query(
        `INSERT INTO schedule_referee_assignments (schedule_id, referee_id, position, is_final_authority, assigned_by)
         VALUES ($1, $2, 'REFEREE', TRUE, $3)`,
        [result.rows[0].id, input.refereeId, createdBy],
      );
      await client.query(
        `INSERT INTO schedule_referee_assignment_history (schedule_id, before_assignments, after_assignments, changed_by, reason)
         VALUES ($1, '[]'::jsonb, $2::jsonb, $3, 'Initial assignment during schedule creation')`,
        [result.rows[0].id, JSON.stringify([{ refereeId: input.refereeId, position: "REFEREE", isFinalAuthority: true }]), createdBy],
      );
    }
    await client.query("COMMIT");
    await publishCommittedMatchUpdate(input.matchId, "schedule.created");
    return mapSchedule(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateSchedule(
  id: string,
  input: ScheduleUpdateInput,
  guard: ScheduleConflictGuard,
  validateTeamRest: () => Promise<void>,
  changedBy: string,
): Promise<Schedule | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{
      tournament_id: string;
      match_id: string;
      venue_id: string;
      referee_id: string | null;
      scheduled_date: string;
      duration_minutes: number;
      status: string;
      is_locked: boolean;
    }>(
      `SELECT tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, is_locked
       FROM schedules WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!current.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const row = current.rows[0];
    await assertScheduleMatchMutable(row.match_id);
    if (row.is_locked && (input.venueId !== undefined || input.scheduledDate !== undefined || input.durationMinutes !== undefined)) {
      throw new AppError(409, "Lịch trận đã khóa; mở khóa trước khi đổi ngày, giờ hoặc sân", "SCHEDULE_LOCKED");
    }
    const beforeState = {
      venueId: row.venue_id,
      scheduledDate: new Date(row.scheduled_date).toISOString(),
      durationMinutes: row.duration_minutes,
      status: row.status,
    };
    const next: ScheduleCreateInput = {
      tournamentId: row.tournament_id,
      matchId: row.match_id,
      venueId: input.venueId ?? row.venue_id,
      scheduledDate: input.scheduledDate ?? row.scheduled_date,
      durationMinutes: input.durationMinutes ?? row.duration_minutes,
      refereeId: row.referee_id ?? undefined,
    };
    const activeOfficials = await client.query<{ referee_id: string }>(
      "SELECT referee_id FROM schedule_referee_assignments WHERE schedule_id = $1 AND is_active = TRUE UNION SELECT referee_id FROM schedule_referee_draft_slots WHERE schedule_id=$1",
      [id],
    );
    const refereeIds = [...new Set([
      ...guard.refereeIds,
      ...activeOfficials.rows.map((assignment) => assignment.referee_id),
      ...(row.referee_id ? [row.referee_id] : []),
    ])];
    await lockScheduleResources(client, [row.venue_id, next.venueId, row.match_id, ...guard.teamIds, ...refereeIds]);
    if ((input.status ?? row.status) !== "CANCELLED") {
      await assertDraftReservationsForSchedule(client, id, refereeIds, { ...next, durationMinutes: next.durationMinutes ?? row.duration_minutes });
      await assertNoScheduleConflicts(client, next, { ...guard, refereeIds }, id);
      await validateTeamRest();
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (input.venueId !== undefined) { sets.push(`venue_id = $${idx++}`); values.push(input.venueId); }
    if (input.refereeId !== undefined) { sets.push(`referee_id = $${idx++}`); values.push(input.refereeId); }
    if (input.scheduledDate !== undefined) { sets.push(`scheduled_date = $${idx++}`); values.push(input.scheduledDate); }
    if (input.durationMinutes !== undefined) { sets.push(`duration_minutes = $${idx++}`); values.push(input.durationMinutes); }
    if (input.status !== undefined) { sets.push(`status = $${idx++}`); values.push(input.status); }
    if (!sets.length) {
      await client.query("COMMIT");
      return findScheduleById(id);
    }
    sets.push("updated_at = NOW()");
    values.push(id);
    await client.query(`UPDATE schedules SET ${sets.join(", ")} WHERE id = $${idx}`, values);
    const afterState = {
      venueId: next.venueId,
      scheduledDate: new Date(next.scheduledDate).toISOString(),
      durationMinutes: next.durationMinutes ?? row.duration_minutes,
      status: input.status ?? row.status,
    };
    if (JSON.stringify(beforeState) !== JSON.stringify(afterState)) {
      await client.query(
        `INSERT INTO schedule_change_history (schedule_id, before_state, after_state, changed_by, reason)
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5)`,
        [id, JSON.stringify(beforeState), JSON.stringify(afterState), changedBy, input.reason?.trim() || null],
      );
    }
    await client.query("COMMIT");
    await publishCommittedMatchUpdate(
      row.match_id,
      input.status === "CANCELLED" ? "schedule.cancelled" : "schedule.updated",
    );
    return findScheduleById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listScheduleChangeHistory(scheduleId: string): Promise<ScheduleChangeHistory[]> {
  const result = await getPool().query(
    `SELECT id, before_state, after_state, changed_by, reason, changed_at
     FROM schedule_change_history WHERE schedule_id = $1
     ORDER BY changed_at DESC LIMIT 100`,
    [scheduleId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    before: row.before_state,
    after: row.after_state,
    changedBy: row.changed_by,
    reason: row.reason,
    changedAt: row.changed_at,
  }));
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ match_id: string; is_locked: boolean }>(
      "SELECT match_id, is_locked FROM schedules WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!current.rowCount) {
      await client.query("COMMIT");
      return false;
    }
    if (current.rows[0].is_locked) throw new AppError(409, "Lịch trận đã khóa; mở khóa trước khi xóa", "SCHEDULE_LOCKED");
    await assertScheduleMatchMutable(current.rows[0].match_id);
    await client.query("DELETE FROM schedules WHERE id = $1", [id]);
    await client.query("COMMIT");
    await publishCommittedMatchUpdate(current.rows[0].match_id, "schedule.deleted");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
    SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, is_locked, notes, slot_id, created_by, created_at, updated_at
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
    SELECT id, tournament_id, match_id, venue_id, referee_id, scheduled_date, duration_minutes, status, is_locked, notes, slot_id, created_by, created_at, updated_at
    FROM schedules schedule
    WHERE (schedule.referee_id = $1 OR EXISTS (
        SELECT 1 FROM schedule_referee_assignments assignment
        WHERE assignment.schedule_id = schedule.id AND assignment.referee_id = $1 AND assignment.is_active = TRUE
      ))
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

import type {
  Venue,
  VenueCreateInput,
  VenueUpdateInput,
  VenueAvailability,
  VenueAvailabilityCreateInput,
  Schedule,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ConflictCheck,
} from "../models/scheduling";
import { AppError } from "../lib/errors";
import { config as schedulingConfig } from "../config";
import { config as matchConfig } from "../../config";
import { getMatch, updateMatchInfo } from "../../services/matchService";
import {
  findVenueById,
  listVenues,
  createVenue,
  updateVenue,
  deleteVenue,
  listVenueAvailability,
  createVenueAvailability,
  deleteVenueAvailability,
  findScheduleById,
  listSchedules,
  findScheduleByMatchId,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  checkVenueConflicts,
  checkRefereeConflicts,
  isVenueAvailableDuring,
  isRefereeAssignedToMatch,
  listSchedulesByReferee,
} from "../repositories/schedulingRepository";

type TournamentScheduleSettings = {
  id: string;
  startDate: string | null;
  endDate: string | null;
  rules?: { minimumRestMinutes?: number; matchDurationMinutes?: number } | null;
};

async function getTournamentScheduleSettings(tournamentId: string): Promise<TournamentScheduleSettings> {
  let endpoint: string;
  try {
    endpoint = new URL(
      `/tournaments/${encodeURIComponent(tournamentId)}`,
      matchConfig.tournamentServiceUrl,
    ).toString();
  } catch {
    throw new AppError(503, "Tournament service URL is invalid", "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, { signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new AppError(503, "Tournament service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, "Tournament configuration could not be loaded", "UPSTREAM_ERROR");
  }
  const body = await response.json() as { tournament?: TournamentScheduleSettings };
  if (!body.tournament || body.tournament.id !== tournamentId) {
    throw new AppError(502, "Tournament service returned invalid configuration", "UPSTREAM_ERROR");
  }
  return body.tournament;
}

async function assertScheduleDateAndMatch(
  input: ScheduleCreateInput,
): Promise<{ matchDate: Date; endDate: Date; minimumRestMinutes: number }> {
  const matchDate = new Date(input.scheduledDate);
  if (!Number.isFinite(matchDate.getTime()) || matchDate.getTime() <= Date.now()) {
    throw new AppError(400, "A future scheduledDate is required", "INVALID_DATE");
  }
  const durationMinutes = input.durationMinutes ?? 90;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) {
    throw new AppError(400, "durationMinutes must be between 1 and 240", "INVALID_DURATION");
  }
  const match = await getMatch(input.matchId);
  if (match.tournamentId !== input.tournamentId) {
    throw new AppError(400, "Match does not belong to this tournament", "MATCH_TOURNAMENT_MISMATCH");
  }
  if (!["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(match.status)) {
    throw new AppError(409, "Only unscheduled, scheduled or postponed matches can be assigned a schedule", "MATCH_NOT_SCHEDULABLE");
  }
  const endDate = new Date(matchDate.getTime() + durationMinutes * 60_000);
  const tournament = await getTournamentScheduleSettings(input.tournamentId);
  if (tournament.startDate && matchDate < new Date(tournament.startDate)) {
    throw new AppError(400, "Match is before the tournament start date", "OUTSIDE_TOURNAMENT_DATES");
  }
  if (tournament.endDate && endDate > new Date(tournament.endDate)) {
    throw new AppError(400, "Match ends after the tournament end date", "OUTSIDE_TOURNAMENT_DATES");
  }
  return {
    matchDate,
    endDate,
    minimumRestMinutes: tournament.rules?.minimumRestMinutes ?? schedulingConfig.minRestMinutes,
  };
}

async function checkTeamRestConflicts(
  input: ScheduleCreateInput,
  excludeScheduleId: string | undefined,
  minimumRestMinutes: number,
): Promise<ConflictCheck["conflicts"]> {
  const candidateMatch = await getMatch(input.matchId);
  const candidateStart = new Date(input.scheduledDate).getTime();
  const candidateEnd = candidateStart + (input.durationMinutes ?? 90) * 60_000;
  const schedules = await listSchedules(input.tournamentId);
  const conflicts: ConflictCheck["conflicts"] = [];
  for (const schedule of schedules) {
    if (schedule.id === excludeScheduleId || schedule.status === "CANCELLED" || schedule.matchId === input.matchId) {
      continue;
    }
    const otherMatch = await getMatch(schedule.matchId);
    const sharedTeam =
      candidateMatch.homeTeamId === otherMatch.homeTeamId ||
      candidateMatch.homeTeamId === otherMatch.awayTeamId ||
      candidateMatch.awayTeamId === otherMatch.homeTeamId ||
      candidateMatch.awayTeamId === otherMatch.awayTeamId;
    if (!sharedTeam) continue;
    const otherStart = new Date(schedule.scheduledDate).getTime();
    const otherEnd = otherStart + schedule.durationMinutes * 60_000;
    const gap = candidateStart >= otherStart
      ? candidateStart - otherEnd
      : otherStart - candidateEnd;
    if (gap < minimumRestMinutes * 60_000) {
      conflicts.push({
        type: "team",
        scheduleId: schedule.id,
        reason: `A team has another match within the ${minimumRestMinutes}-minute rest interval`,
      });
    }
  }
  return conflicts;
}

// Venues
export async function getVenue(id: string): Promise<Venue> {
  const venue = await findVenueById(id);
  if (!venue) {
    throw new AppError(404, "Venue not found", "VENUE_NOT_FOUND");
  }
  return venue;
}

export async function getVenues(isActive?: boolean): Promise<Venue[]> {
  return listVenues(isActive);
}

export async function createNewVenue(input: VenueCreateInput): Promise<Venue> {
  if (!input.name.trim()) {
    throw new AppError(400, "Venue name is required", "INVALID_NAME");
  }
  if (!input.location.trim()) {
    throw new AppError(400, "Location is required", "INVALID_LOCATION");
  }
  if (input.capacity !== undefined && input.capacity <= 0) {
    throw new AppError(400, "Capacity must be greater than 0", "INVALID_CAPACITY");
  }

  return createVenue(input);
}

export async function updateVenueInfo(id: string, input: VenueUpdateInput): Promise<Venue> {
  const existing = await findVenueById(id);
  if (!existing) {
    throw new AppError(404, "Venue not found", "VENUE_NOT_FOUND");
  }

  if (input.name !== undefined && !input.name.trim()) {
    throw new AppError(400, "Venue name is required", "INVALID_NAME");
  }
  if (input.capacity !== undefined && input.capacity <= 0) {
    throw new AppError(400, "Capacity must be greater than 0", "INVALID_CAPACITY");
  }

  const updated = await updateVenue(id, input);
  if (!updated) {
    throw new AppError(404, "Venue not found", "VENUE_NOT_FOUND");
  }
  return updated;
}

export async function removeVenue(id: string): Promise<void> {
  const existing = await findVenueById(id);
  if (!existing) {
    throw new AppError(404, "Venue not found", "VENUE_NOT_FOUND");
  }

  await deleteVenue(id);
}

// Venue Availability
export async function getVenueAvailability(venueId: string): Promise<VenueAvailability[]> {
  const venue = await findVenueById(venueId);
  if (!venue) {
    throw new AppError(404, "Venue not found", "VENUE_NOT_FOUND");
  }

  return listVenueAvailability(venueId);
}

export async function createNewVenueAvailability(input: VenueAvailabilityCreateInput): Promise<VenueAvailability> {
  const venue = await findVenueById(input.venueId);
  if (!venue) {
    throw new AppError(404, "Venue not found", "VENUE_NOT_FOUND");
  }

  if (new Date(input.availableFrom) >= new Date(input.availableTo)) {
    throw new AppError(400, "availableFrom must be before availableTo", "INVALID_DATES");
  }

  return createVenueAvailability(input);
}

export async function removeVenueAvailability(id: string): Promise<void> {
  const deleted = await deleteVenueAvailability(id);
  if (!deleted) {
    throw new AppError(404, "Venue availability not found", "AVAILABILITY_NOT_FOUND");
  }
}

// Schedules
export async function getSchedule(id: string): Promise<Schedule> {
  const schedule = await findScheduleById(id);
  if (!schedule) {
    throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  }
  return schedule;
}

export async function getPublicSchedule(id: string): Promise<Schedule> {
  const schedule = await getSchedule(id);
  if (schedule.status !== "PUBLISHED") {
    throw new AppError(404, "Published schedule not found", "SCHEDULE_NOT_FOUND");
  }
  return schedule;
}

export async function getSchedules(tournamentId: string, status?: string): Promise<Schedule[]> {
  return listSchedules(tournamentId, status ?? "PUBLISHED");
}

export async function getSchedulesForManager(tournamentId: string, status?: string): Promise<Schedule[]> {
  return listSchedules(tournamentId, status);
}

export async function getSchedulesForReferee(refereeId: string): Promise<Schedule[]> {
  return listSchedulesByReferee(refereeId);
}

export async function refereeIsAssignedToMatch(
  matchId: string,
  refereeId: string,
): Promise<boolean> {
  return isRefereeAssignedToMatch(matchId, refereeId);
}

export async function getScheduleByMatchId(matchId: string): Promise<Schedule> {
  const schedule = await findScheduleByMatchId(matchId);
  if (!schedule || schedule.status !== "PUBLISHED") {
    throw new AppError(404, "Published schedule not found for this match", "SCHEDULE_NOT_FOUND");
  }
  return schedule;
}

export async function checkConflicts(
  input: ScheduleCreateInput,
  excludeScheduleId?: string,
): Promise<ConflictCheck> {
  const conflicts: ConflictCheck["conflicts"] = [];
  const { matchDate, endDate, minimumRestMinutes } = await assertScheduleDateAndMatch(input);
  const venue = await findVenueById(input.venueId);
  if (!venue || !venue.isActive) {
    throw new AppError(409, "Chỉ được xếp trận tại sân đang hoạt động", "VENUE_NOT_ACTIVE");
  }
  if (!(await isVenueAvailableDuring(input.venueId, matchDate, endDate))) {
    throw new AppError(409, "Sân không khả dụng trong khoảng thời gian này", "VENUE_UNAVAILABLE");
  }

  // Check venue conflicts
  const venueConflicts = await checkVenueConflicts(
    input.venueId,
    input.scheduledDate,
    input.durationMinutes ?? 90,
    excludeScheduleId,
  );
  for (const conflict of venueConflicts) {
    conflicts.push({
      type: "venue",
      scheduleId: conflict.id,
      reason: `Venue already booked at ${conflict.scheduledDate}`,
    });
  }

  // Check referee conflicts
  if (input.refereeId) {
    const refereeConflicts = await checkRefereeConflicts(
      input.refereeId,
      input.scheduledDate,
      input.durationMinutes ?? 90,
      excludeScheduleId,
    );
    for (const conflict of refereeConflicts) {
      conflicts.push({
        type: "referee",
        scheduleId: conflict.id,
        reason: `Referee already assigned at ${conflict.scheduledDate}`,
      });
    }
  }
  conflicts.push(...await checkTeamRestConflicts(input, excludeScheduleId, minimumRestMinutes));

  return {
    hasConflict: conflicts.length > 0,
    conflicts,
  };
}

export async function createNewSchedule(input: ScheduleCreateInput, createdBy: string): Promise<Schedule> {
  // Check conflicts
  const conflictCheck = await checkConflicts(input);
  if (conflictCheck.hasConflict) {
    throw new AppError(409, "Schedule conflicts detected", "CONFLICT_DETECTED");
  }
  const existing = await findScheduleByMatchId(input.matchId);
  if (existing && existing.status !== "CANCELLED") {
    throw new AppError(409, "A non-cancelled schedule already exists for this match", "SCHEDULE_ALREADY_EXISTS");
  }

  return createSchedule(input, createdBy);
}

export async function updateScheduleInfo(id: string, input: ScheduleUpdateInput): Promise<Schedule> {
  const existing = await findScheduleById(id);
  if (!existing) {
    throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  }

  // Cannot modify published schedule without proper authorization (future check)
  if (existing.status === "PUBLISHED" && input.status !== "CANCELLED") {
    throw new AppError(400, "Cannot modify published schedule", "SCHEDULE_PUBLISHED");
  }

  if (
    input.venueId ||
    input.scheduledDate ||
    input.refereeId ||
    input.durationMinutes !== undefined ||
    input.status === "PUBLISHED"
  ) {
    const validationInput: ScheduleCreateInput = {
      tournamentId: existing.tournamentId,
      matchId: existing.matchId,
      venueId: input.venueId ?? existing.venueId,
      refereeId: input.refereeId ?? existing.refereeId ?? undefined,
      scheduledDate: input.scheduledDate ?? existing.scheduledDate,
      durationMinutes: input.durationMinutes ?? existing.durationMinutes,
    };
    const conflictCheck = await checkConflicts(validationInput, id);
    if (conflictCheck.hasConflict) {
      throw new AppError(409, "Schedule conflicts detected", "CONFLICT_DETECTED");
    }
  }

  const updated = await updateSchedule(id, input);
  if (!updated) {
    throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  }
  if (updated.status === "PUBLISHED" && existing.status !== "PUBLISHED") {
    const match = await getMatch(updated.matchId);
    try {
      await updateMatchInfo(updated.matchId, {
        matchDate: updated.scheduledDate,
        ...(match.status === "UNSCHEDULED" || match.status === "POSTPONED"
          ? { status: "SCHEDULED" as const }
          : {}),
      });
    } catch (error) {
      await updateSchedule(id, { status: "DRAFT" });
      throw error;
    }
  }
  if (updated.status === "CANCELLED" && existing.status === "PUBLISHED") {
    try {
      await updateMatchInfo(updated.matchId, { status: "POSTPONED" });
    } catch (error) {
      await updateSchedule(id, { status: "PUBLISHED" });
      throw error;
    }
  }
  return updated;
}

export async function removeSchedule(id: string): Promise<void> {
  const existing = await findScheduleById(id);
  if (!existing) {
    throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  }

  await deleteSchedule(id);
}

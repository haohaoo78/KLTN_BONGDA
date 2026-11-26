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
  RefereeCandidate,
  ScheduleRefereeAssignment,
  ScheduleRefereeAssignmentInput,
  ScheduleRefereeAssignmentHistory,
  ScheduleChangeHistory,
} from "../models/scheduling";
import { automaticScheduleBaseSignature, matchPlayMinutes, normalizeScheduleDecisionTiming, validateSchedulePlan, validateScheduleResourceConfiguration, validateScheduleSetupAgainstTournament, type ScheduleSetupTournamentContext, type DemoFixture, type DemoScheduleEntry, type DemoScheduleResources } from "@sfl/shared";
import { AppError } from "../lib/errors";
import { validateCrewAssignments } from "../crewValidation";
import { configuredPositionsForMatch } from "../repositories/refereeConfigurationRepository";
import { assertBracketMatchSchedulable } from "../bracketReadiness";
import { config as schedulingConfig } from "../config";
import { config as matchConfig } from "../../config";
import { getMatch, updateMatchInfo } from "../../services/matchService";
import { getPool as getMatchPool } from "../../lib/db";
import { getPublishedDraw } from "../../services/fixtureGenerationService";
import { listManagedKnockoutBracket, listManagedTournamentFixtures } from "../../repositories/matchRepository";
import { getKnockoutMatchReadiness, getKnockoutMatchPossibleEntrants, isFixtureMatchPublic } from "../../repositories/matchRepository";
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
  listScheduleRefereeAssignments,
  replaceScheduleRefereeAssignments,
  findRefereeAssignmentForMatch,
  listScheduleRefereeAssignmentHistory,
  listScheduleChangeHistory,
  setScheduleLock,
  getTournamentScheduleResources as findTournamentScheduleResources,
  saveTournamentScheduleResources as persistTournamentScheduleResources,
  saveScheduleDraftBatch,
  publishScheduleBatch,
} from "../repositories/schedulingRepository";

type TournamentScheduleSettings = {
  id: string;
  name: string;
  status: string;
  location: string | null;
  competitionFormat: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  startDate: string | null;
  endDate: string | null;
  footballFormat: 5 | 7 | 11;
  rules?: ScheduleSetupTournamentContext["rules"] & { publishedVersion?: number };
};

export async function getTournamentScheduleSettings(tournamentId: string): Promise<TournamentScheduleSettings> {
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
    response = await fetch(endpoint, {
      headers: matchConfig.internalApiKey
        ? { "x-gateway-internal-key": matchConfig.internalApiKey }
        : {},
      signal: AbortSignal.timeout(5_000),
    });
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
  if (![5, 7, 11].includes(Number(body.tournament.footballFormat))) {
    throw new AppError(502, "Tournament service returned an invalid football format", "UPSTREAM_ERROR");
  }
  return body.tournament;
}

async function notifyScheduleChange(schedule: Schedule, match: Awaited<ReturnType<typeof getMatch>>, reason?: string): Promise<string[]> {
  const recipients = new Set<string>();
  const failures: string[] = [];
  const teamIds = [...new Set([match.homeTeamId, match.awayTeamId].filter((teamId): teamId is string => Boolean(teamId)))];
  const captainResults = await Promise.all(teamIds.map(async (teamId) => {
    try {
      const endpoint = new URL(`/internal/teams/${encodeURIComponent(teamId)}/captain-notification-recipient`, matchConfig.organizationServiceUrl);
      const response = await fetch(endpoint, {
        headers: matchConfig.internalApiKey ? { "x-gateway-internal-key": matchConfig.internalApiKey } : {},
        signal: AbortSignal.timeout(5_000),
      });
        if (!response.ok) return { teamId, userId: null };
      const body = await response.json() as { userId?: string | null };
      return { teamId, userId: body.userId ?? null };
    } catch {
      return { teamId, userId: null };
    }
  }));
  for (const result of captainResults) {
    if (result.userId) recipients.add(result.userId);
    else failures.push(`captain:${result.teamId}`);
  }
  for (const assignment of await listScheduleRefereeAssignments(schedule.id)) recipients.add(assignment.refereeId);

  const title = schedule.status === "CANCELLED" ? "Trận đấu đã hoãn/hủy lịch" : "Lịch thi đấu đã thay đổi";
  const body = schedule.status === "CANCELLED"
    ? `Lịch trận ${schedule.matchId} đã bị hủy. Lý do: ${reason?.trim() || "BTC cập nhật lịch"}.`
    : `Trận ${schedule.matchId} được xếp lúc ${new Date(schedule.scheduledDate).toLocaleString("vi-VN")}. ${reason?.trim() ? `Lý do: ${reason.trim()}` : ""}`.trim();
    await Promise.all([...recipients].map(async (userId) => {
    try {
      const response = await fetch(new URL("/internal/notifications", matchConfig.notificationServiceUrl), {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-api-key": matchConfig.internalApiKey },
        body: JSON.stringify({
          userId,
          type: "MATCH_SCHEDULE_CHANGED",
          title,
          body,
          data: { category: "MATCH_SCHEDULE_CHANGED", scheduleId: schedule.id, matchId: schedule.matchId, tournamentId: schedule.tournamentId, status: schedule.status },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) failures.push(userId);
    } catch {
      failures.push(userId);
    }
  }));
  return failures;
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
  if (!await isFixtureMatchPublic(match.id)) {
    throw new AppError(409, "Chỉ được lập lịch cho fixture đã công bố", "PUBLISHED_FIXTURE_REQUIRED");
  }
  assertBracketMatchSchedulable(await getKnockoutMatchReadiness(input.matchId));
  if (match.tournamentId !== input.tournamentId) {
    throw new AppError(400, "Match does not belong to this tournament", "MATCH_TOURNAMENT_MISMATCH");
  }
  if (!["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(match.status)) {
    throw new AppError(409, "Only unscheduled, scheduled or postponed matches can be assigned a schedule", "MATCH_NOT_SCHEDULABLE");
  }
  const endDate = new Date(matchDate.getTime() + durationMinutes * 60_000);
  const tournament = await getTournamentScheduleSettings(input.tournamentId);
  const tournamentStart = tournament.startDate ? tournamentDateBoundary(tournament.startDate, false) : null;
  const tournamentEnd = tournament.endDate ? tournamentDateBoundary(tournament.endDate, true) : null;
  if (tournamentStart && matchDate < tournamentStart) {
    throw new AppError(400, "Match is before the tournament start date", "OUTSIDE_TOURNAMENT_DATES");
  }
  if (tournamentEnd && endDate > tournamentEnd) {
    throw new AppError(400, "Match ends after the tournament end date", "OUTSIDE_TOURNAMENT_DATES");
  }
  const startWindow = tournament.rules?.competitionConfig?.schedulingStartTime;
  const endWindow = tournament.rules?.competitionConfig?.schedulingEndTime;
  if (startWindow && endWindow) {
    const localTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(matchDate);
    const localEndTime = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(endDate);
    if (localTime < startWindow || localTime >= endWindow || localEndTime > endWindow) {
      throw new AppError(400, `Trận phải diễn ra trong khung giờ ${startWindow}–${endWindow} (giờ Việt Nam)`, "OUTSIDE_SCHEDULING_WINDOW");
    }
  }
  return {
    matchDate,
    endDate,
    minimumRestMinutes: tournament.rules?.minimumRestMinutes ?? schedulingConfig.minRestMinutes,
  };
}

function tournamentDateBoundary(value: string, endOfDay: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  }
  return new Date(value);
}

async function checkTeamRestConflicts(
  input: ScheduleCreateInput,
  excludeScheduleId: string | undefined,
  minimumRestMinutes: number,
): Promise<ConflictCheck["conflicts"]> {
  const candidateMatch = await getMatch(input.matchId);
  const candidateEntrants = await getKnockoutMatchPossibleEntrants(input.matchId)
    ?? [candidateMatch.homeTeamId, candidateMatch.awayTeamId].filter((teamId): teamId is string => Boolean(teamId));
  const candidateStart = new Date(input.scheduledDate).getTime();
  const candidateEnd = candidateStart + (input.durationMinutes ?? 90) * 60_000;
  const schedules = await listSchedules(input.tournamentId);
  const conflicts: ConflictCheck["conflicts"] = [];
  for (const schedule of schedules) {
    if (schedule.id === excludeScheduleId || schedule.status === "CANCELLED" || schedule.matchId === input.matchId) {
      continue;
    }
    const otherMatch = await getMatch(schedule.matchId);
    const otherEntrants = await getKnockoutMatchPossibleEntrants(schedule.matchId)
      ?? [otherMatch.homeTeamId, otherMatch.awayTeamId].filter((teamId): teamId is string => Boolean(teamId));
    const candidateSet = new Set(candidateEntrants);
    const sharedTeam = otherEntrants.some((teamId) => candidateSet.has(teamId));
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

async function assertTeamRestAvailable(
  input: ScheduleCreateInput,
  excludeScheduleId: string | undefined,
  minimumRestMinutes: number,
): Promise<void> {
  const conflicts = await checkTeamRestConflicts(input, excludeScheduleId, minimumRestMinutes);
  if (conflicts.length) {
    throw new AppError(409, conflicts[0].reason, "TEAM_REST_CONFLICT");
  }
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

export async function setScheduleLocked(id: string, isLocked: boolean): Promise<Schedule> {
  const current = await getSchedule(id);
  if (current.status !== "DRAFT") {
    throw new AppError(409, "Chỉ được khóa hoặc mở khóa lịch nháp chưa công bố", "SCHEDULE_LOCK_STATE_RESTRICTED");
  }
  const match = await getMatch(current.matchId);
  if (!["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(match.status)) {
    throw new AppError(409, "Trận đã bắt đầu hoặc bị hạn chế chỉnh sửa", "SCHEDULE_MATCH_RESTRICTED");
  }
  if (isLocked) {
    const validation = await checkConflicts({
      tournamentId: current.tournamentId, matchId: current.matchId, venueId: current.venueId,
      scheduledDate: current.scheduledDate, durationMinutes: current.durationMinutes,
    }, current.id);
    if (validation.hasConflict) {
      throw new AppError(409, `Không thể khóa lịch chưa hợp lệ: ${validation.conflicts[0]?.reason ?? "có xung đột"}`, "SCHEDULE_LOCK_REQUIRES_VALID_SCHEDULE", { conflicts: validation.conflicts });
    }
  }
  const saved = await setScheduleLock(id, isLocked);
  if (!saved) throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  return saved;
}

export async function getTournamentSchedulingResources(tournamentId: string) {
  return findTournamentScheduleResources(tournamentId);
}

export async function saveTournamentSchedulingResources(
  tournamentId: string,
  value: unknown,
  updatedBy: string,
  expectedRevision: number | null,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "Cấu hình lập lịch không hợp lệ", "INVALID_SCHEDULE_RESOURCES");
  }
  const candidate = value as DemoScheduleResources;
  if (!Array.isArray(candidate.venues) || !Array.isArray(candidate.slots)
    || !Array.isArray(candidate.allowedWeekdays) || !Array.isArray(candidate.blockedDates)
    || !candidate.groupTiming || !candidate.knockoutTiming) {
    throw new AppError(400, "Cấu hình thiếu sân, giờ hoặc thời lượng trận", "INVALID_SCHEDULE_RESOURCES");
  }
  const currentContext = await getOfficialScheduleContext(tournamentId);
  const resources = normalizeScheduleDecisionTiming(currentContext.tournamentContext, candidate);
  if (Buffer.byteLength(JSON.stringify(resources), "utf8") > 1_000_000 || resources.venues.length > 128 || resources.slots.length > 96) {
    throw new AppError(413, "Cấu hình nguồn lực vượt giới hạn API", "SCHEDULE_RESOURCES_TOO_LARGE");
  }
  for (const timing of [resources.groupTiming, resources.knockoutTiming]) {
    if (!Number.isInteger(timing.halfMinutes) || timing.halfMinutes < 1 || timing.halfMinutes > 120
      || [timing.halftimeBreakMinutes, timing.preparationBeforeMinutes, timing.transitionAfterMinutes, timing.extraTimeReserveMinutes, timing.penaltyReserveMinutes].some((minutes) => !Number.isInteger(minutes) || minutes < 0 || minutes > 240)) {
      throw new AppError(400, "Thời lượng hiệp, nghỉ, chuẩn bị và chuyển tiếp phải là số phút hợp lệ", "INVALID_SCHEDULE_TIMING");
    }
  }
  if ([resources.minimumTeamRestMinutes, resources.maximumMatchesPerTeamPerDay, resources.travelBufferMinutes].some((value) => !Number.isInteger(value) || value < 0)) throw new AppError(400, "Điều kiện nghỉ và giới hạn trận phải là số nguyên không âm", "INVALID_SCHEDULE_TIMING");
  let resourceIssues;
  try { resourceIssues = validateScheduleResourceConfiguration(resources); }
  catch { throw new AppError(400, "Cấu hình sân hoặc thời gian khả dụng không hợp lệ", "INVALID_SCHEDULE_RESOURCES"); }
  const invalid = resourceIssues
    .filter((issue) => issue.severity === "HARD" && issue.code !== "SETUP_CONFIRMATION_REQUIRED");
  if (invalid.length) throw new AppError(400, invalid[0].message, "INVALID_SCHEDULE_RESOURCES", { issues: invalid });
  if (currentContext.schedules.some((schedule) => schedule.status === "PUBLISHED")) {
    throw new AppError(409, "Lịch đã công bố; không được thay thế cấu hình nguồn lực", "PUBLISHED_SCHEDULE_RESOURCES_LOCKED");
  }
  if (currentContext.resources) assertProtectedScheduleTimingUnchanged(currentContext.fixtures, currentContext.entries, currentContext.resources, resources);
  const regulationIssues = validateScheduleSetupAgainstTournament(currentContext.tournamentContext, resources, currentContext.fixtures);
  if (regulationIssues.length) throw new AppError(409, regulationIssues[0], "SCHEDULE_SETUP_REGULATION_CONFLICT", { issues: regulationIssues });
  const invalidLocked = validateSchedulePlan(currentContext.fixtures, currentContext.entries, resources, currentContext.pitchType).filter((issue) => issue.fixtureId && currentContext.entries[issue.fixtureId]?.locked && issue.severity !== "WARNING");
  if (invalidLocked.length) throw new AppError(409, "Thay đổi nguồn lực làm lịch đã khóa không hợp lệ", "SCHEDULE_LOCKED_RESOURCE_CONFLICT", { issues: invalidLocked });
  for (const venue of resources.venues) {
    const officialVenue = typeof venue.id === "string" ? await findVenueById(venue.id) : null;
    if (!officialVenue) {
      throw new AppError(409, `Sân ${venue.name ?? ""} chưa tồn tại trong danh mục sân chính thức.`, "OFFICIAL_VENUE_REQUIRED");
    }
    if (venue.active && !officialVenue.isActive) throw new AppError(409, `Sân ${officialVenue.name} đang bị khóa trong danh mục chính thức.`, "VENUE_NOT_ACTIVE");
  }
  const saved = await persistTournamentScheduleResources(tournamentId, resources as unknown as Record<string, unknown>, updatedBy, expectedRevision, async () => {
    const latest = await getOfficialScheduleContext(tournamentId);
    if (latest.schedules.some((schedule) => schedule.status === "PUBLISHED")) throw new AppError(409, "Lịch đã được công bố ở phiên khác", "PUBLISHED_SCHEDULE_RESOURCES_LOCKED");
    if (latest.resources) assertProtectedScheduleTimingUnchanged(latest.fixtures, latest.entries, latest.resources, resources);
    const lockedIssues = validateSchedulePlan(latest.fixtures, latest.entries, resources, latest.pitchType).filter((issue) => issue.fixtureId && latest.entries[issue.fixtureId]?.locked && issue.severity !== "WARNING");
    if (lockedIssues.length) throw new AppError(409, "Thay đổi nguồn lực làm lịch đã khóa không hợp lệ", "SCHEDULE_LOCKED_RESOURCE_CONFLICT", { issues: lockedIssues });
  });
  if (!saved) throw new AppError(409, "Cấu hình nguồn lực đã thay đổi ở phiên khác. Tải lại trước khi lưu.", "SCHEDULE_RESOURCES_REVISION_CONFLICT");
  return saved;
}

export async function getOfficialScheduleContext(tournamentId: string) {
  const [draw, fixtureBundle, bracket, schedules, resourcesRecord, tournament] = await Promise.all([
    getPublishedDraw(tournamentId),
    listManagedTournamentFixtures(tournamentId),
    listManagedKnockoutBracket(tournamentId),
    getSchedulesForManager(tournamentId),
    getTournamentSchedulingResources(tournamentId),
    getTournamentScheduleSettings(tournamentId),
  ]);
  const publishedStages = fixtureBundle.stages.filter((stage) => stage.status === "PUBLISHED" && stage.drawVersionId === draw.id);
  assertPublishedScheduleStages(draw.config?.fixtureRegulationSnapshot?.competitionFormat ?? tournament.competitionFormat, publishedStages.map((stage) => stage.stage));
  const groupNameById = new Map(draw.groups.map((group) => [group.id, group.name]));
  const bracketByMatchId = new Map(bracket.filter((slot) => slot.matchId).map((slot) => [slot.matchId!, slot]));
  const bracketBySlotId = new Map(bracket.map((slot) => [slot.id, slot]));
  const knockoutRoundCount = Math.max(0, ...bracket.filter((slot) => slot.slotType !== "THIRD_PLACE").map((slot) => slot.roundNumber));
  const sourceLabel = (side: "home" | "away", slot: (typeof bracket)[number] | undefined): string | undefined => {
    if (!slot) return undefined;
    const qualification = side === "home" ? slot.homeQualification : slot.awayQualification;
    if (qualification) {
      const rank = qualification.groupRank === 1 ? "Nhất" : qualification.groupRank === 2 ? "Nhì" : `Hạng ${qualification.groupRank}`;
      return `${rank} bảng ${(groupNameById.get(qualification.groupId) ?? "?").replace(/^bảng\s+/i, "")}`;
    }
    const sourceSlotId = side === "home" ? slot.homeSourceSlotId : slot.awaySourceSlotId;
    const sourceSlot = sourceSlotId ? bracketBySlotId.get(sourceSlotId) : undefined;
    if (!sourceSlot?.matchId) return undefined;
    const outcome = side === "home" ? slot.homeSourceOutcome : slot.awaySourceOutcome;
    return `${outcome === "LOSER" ? "Thua" : "Thắng"} trận ${sourceSlot.matchId}`;
  };
  const fixtures: DemoFixture[] = publishedStages.flatMap((stage) => stage.matches.map((match) => {
    const slot = stage.stage === "KNOCKOUT" ? bracketByMatchId.get(match.id) : undefined;
    const groupName = match.groupId ? groupNameById.get(match.groupId) : undefined;
    return {
      id: match.id,
      stage: stage.stage,
      ...(groupName ? { groupName } : {}),
      round: officialFixtureRoundLabel({ stage: stage.stage, round: match.round, roundNumber: slot?.roundNumber ?? match.roundNumber, groupName, leg: match.leg, slotType: slot?.slotType, knockoutRoundCount }),
      ...((slot?.roundNumber ?? match.roundNumber) ? { roundNumber: slot?.roundNumber ?? match.roundNumber! } : {}),
      ...(match.leg ? { leg: match.leg } : {}),
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      ...(sourceLabel("home", slot) ? { homeSource: sourceLabel("home", slot) } : {}),
      ...(sourceLabel("away", slot) ? { awaySource: sourceLabel("away", slot) } : {}),
    };
  }));
  const tournamentContext: ScheduleSetupTournamentContext = {
    tournamentId, name: tournament.name, status: tournament.status, location: tournament.location,
    startDate: tournament.startDate, endDate: tournament.endDate, footballFormat: tournament.footballFormat,
    competitionFormat: draw.config?.fixtureRegulationSnapshot?.competitionFormat ?? tournament.competitionFormat,
    teamCount: new Set(draw.groups.flatMap((group) => group.assignments.map((assignment) => assignment.teamId))).size,
    regulationVersion: draw.config?.fixtureRegulationSnapshot?.regulationVersion ?? tournament.rules?.publishedVersion ?? null,
    rules: (draw.config?.fixtureRegulationSnapshot?.rules ?? tournament.rules) as ScheduleSetupTournamentContext["rules"],
  };
  const fixtureStageById = new Map(fixtures.map((fixture) => [fixture.id, fixture.stage]));
  const protectedStages = new Set<DemoFixture["stage"]>(schedules.filter((schedule) => schedule.status !== "CANCELLED" && (schedule.isLocked || schedule.status === "PUBLISHED")).map((schedule) => fixtureStageById.get(schedule.matchId)).filter((stage): stage is DemoFixture["stage"] => Boolean(stage)));
  const storedResources = (resourcesRecord?.resources ?? null) as unknown as DemoScheduleResources | null;
  const resources = storedResources ? normalizeScheduleDecisionTiming(tournamentContext, storedResources, protectedStages) : null;
  const resourceVenueById = new Map((resources?.venues ?? []).map((venue) => [venue.id, venue]));
  const entries: Record<string, DemoScheduleEntry> = {};
  for (const schedule of schedules) {
    if (schedule.status === "CANCELLED") continue;
    entries[schedule.matchId] = projectOfficialScheduleEntry(schedule, resourceVenueById.get(schedule.venueId)?.code ?? schedule.venueId);
  }
  const diagramVersion = `official:${draw.id}:${publishedStages.map((stage) => `${stage.stage}:${stage.publishedAt}`).sort().join("|")}`;
  const publicationCoverage = getOfficialSchedulePublicationCoverage(fixtures, schedules);
  const publishedFixtureIds = new Set(publicationCoverage.publishedFixtureIds);
  const publishedSchedules = schedules.filter((schedule) => schedule.status === "PUBLISHED" && publishedFixtureIds.has(schedule.matchId));
  return {
    tournamentId,
    drawVersionId: draw.id,
    diagramVersion,
    fixtures,
    entries,
    resources,
    resourceRevision: resourcesRecord?.revision ?? 0,
    revision: resourcesRecord?.revision ?? 0,
    baseSignature: resources ? automaticScheduleBaseSignature(fixtures, entries, resources) : null,
    schedulePublishedAt: publicationCoverage.complete && publicationCoverage.publishedFixtureIds.length === publicationCoverage.requiredCount
      ? publishedSchedules.reduce((latest, schedule) => schedule.updatedAt > latest ? schedule.updatedAt : latest, "") : null,
    schedules,
    tournamentContext,
    pitchType: tournament.footballFormat,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    rules: tournamentContext.rules ? { ...tournamentContext.rules, publishedVersion: tournamentContext.regulationVersion } : null,
  };
}

export function assertProtectedScheduleTimingUnchanged(fixtures: DemoFixture[], entries: Record<string, DemoScheduleEntry>, current: DemoScheduleResources, candidate: DemoScheduleResources): void {
  for (const stage of ["GROUP", "KNOCKOUT"] as const) {
    const protectedFixtures = fixtures.filter((fixture) => fixture.stage === stage && entries[fixture.id]?.scheduledAt && (entries[fixture.id].locked || entries[fixture.id].officialStatus === "PUBLISHED"));
    const section = stage === "GROUP" ? "groupTiming" : "knockoutTiming";
    if (protectedFixtures.length && JSON.stringify(current[section]) !== JSON.stringify(candidate[section])) {
      throw new AppError(409, "Mở khóa lịch bị ảnh hưởng trước khi thay đổi thời lượng của giai đoạn thi đấu.", "SCHEDULE_LOCKED_RESOURCE_CONFLICT", { fixtureIds: protectedFixtures.map((fixture) => fixture.id), stage });
    }
  }
}

export function officialFixtureRoundLabel(input: { stage: "GROUP" | "KNOCKOUT"; round?: string | null; roundNumber?: number | null; groupName?: string; leg?: number | null; slotType?: string; knockoutRoundCount?: number }): string {
  const roundNumber = input.roundNumber ?? Number([...((input.round ?? "").matchAll(/vòng\s+(\d+)/gi))].at(-1)?.[1] ?? 0);
  if (input.stage === "GROUP") {
    const groupName = input.groupName?.trim();
    const groupLabel = groupName ? (/^bảng\s/i.test(groupName) ? groupName : `Bảng ${groupName}`) : "";
    return [groupLabel, roundNumber > 0 ? `Vòng ${roundNumber}` : "Vòng bảng", input.leg === 2 ? "Lượt 2" : ""].filter(Boolean).join(" · ");
  }
  if (input.slotType === "THIRD_PLACE" || /hạng\s*(?:ba|3)/i.test(input.round ?? "")) return "Tranh hạng ba";
  const remaining = (input.knockoutRoundCount ?? 0) - roundNumber;
  if (roundNumber > 0 && (input.knockoutRoundCount ?? 0) >= roundNumber) {
    if (remaining === 0) return "Chung kết";
    if (remaining === 1) return "Bán kết";
    if (remaining === 2) return "Tứ kết";
    return `Vòng ${2 ** (remaining + 1)} đội`;
  }
  const knownLabel = (input.round ?? "").match(/chung kết|bán kết|tứ kết/i)?.[0];
  return knownLabel ?? (roundNumber > 0 ? `Vòng ${roundNumber}` : "Vòng loại trực tiếp");
}

export function assertPublishedScheduleStages(format: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT", publishedStages: string[]): void {
  const requiredStages = format === "GROUP_AND_KNOCKOUT" ? ["GROUP", "KNOCKOUT"] : [format === "KNOCKOUT" ? "KNOCKOUT" : "GROUP"];
  const missing = requiredStages.filter((stage) => !publishedStages.includes(stage));
  if (missing.length) throw new AppError(409, "Cần công bố đầy đủ sơ đồ Bước 4 trước khi lập lịch thi đấu.", "PUBLISHED_FIXTURES_REQUIRED", { missingStages: missing });
}

type PublicationSchedule = Pick<Schedule, "matchId" | "status" | "scheduledDate" | "venueId" | "durationMinutes">;

/** Publication covers the entire published diagram, never a filtered preview or a row count. */
export function getOfficialSchedulePublicationCoverage(fixtures: DemoFixture[], schedules: PublicationSchedule[]) {
  const requiredFixtureIds = [...new Set(fixtures.filter((fixture) => !fixture.bye).map((fixture) => fixture.id))];
  const requiredIds = new Set(requiredFixtureIds);
  const schedulesByFixture = new Map<string, PublicationSchedule[]>();
  for (const schedule of schedules) {
    if (schedule.status === "CANCELLED" || !requiredIds.has(schedule.matchId)) continue;
    const rows = schedulesByFixture.get(schedule.matchId) ?? [];
    rows.push(schedule);
    schedulesByFixture.set(schedule.matchId, rows);
  }
  const scheduledFixtureIds: string[] = [];
  const publishedFixtureIds: string[] = [];
  const duplicateFixtureIds: string[] = [];
  for (const fixtureId of requiredFixtureIds) {
    const rows = schedulesByFixture.get(fixtureId) ?? [];
    if (rows.length > 1) {
      duplicateFixtureIds.push(fixtureId);
      continue;
    }
    const schedule = rows[0];
    if (!schedule || !["DRAFT", "PUBLISHED"].includes(schedule.status)
      || typeof schedule.scheduledDate !== "string" || !Number.isFinite(new Date(schedule.scheduledDate).getTime())
      || typeof schedule.venueId !== "string" || !schedule.venueId.trim()
      || !Number.isInteger(schedule.durationMinutes) || schedule.durationMinutes <= 0) continue;
    scheduledFixtureIds.push(fixtureId);
    if (schedule.status === "PUBLISHED") publishedFixtureIds.push(fixtureId);
  }
  const scheduledIds = new Set(scheduledFixtureIds);
  const missingFixtureIds = requiredFixtureIds.filter((fixtureId) => !scheduledIds.has(fixtureId));
  return {
    requiredCount: requiredFixtureIds.length,
    scheduledCount: scheduledFixtureIds.length,
    requiredFixtureIds,
    scheduledFixtureIds,
    publishedFixtureIds,
    missingFixtureIds,
    duplicateFixtureIds,
    complete: requiredFixtureIds.length > 0 && missingFixtureIds.length === 0 && duplicateFixtureIds.length === 0,
  };
}

export function assertOfficialSchedulePublicationComplete(fixtures: DemoFixture[], schedules: PublicationSchedule[]): void {
  const coverage = getOfficialSchedulePublicationCoverage(fixtures, schedules);
  if (!coverage.requiredCount) throw new AppError(409, "Chưa có trận đấu bắt buộc từ sơ đồ Bước 4 đã công bố.", "PUBLISHED_FIXTURES_REQUIRED");
  if (coverage.duplicateFixtureIds.length) throw new AppError(409, "Có trận chứa nhiều lịch đang hoạt động; cần xử lý lịch trùng trước khi công bố.", "SCHEDULE_DUPLICATE_FIXTURES", { fixtureIds: coverage.duplicateFixtureIds });
  if (coverage.missingFixtureIds.length) {
    throw new AppError(409, `Còn ${coverage.missingFixtureIds.length} trận chưa có lịch hợp lệ: ${coverage.missingFixtureIds.slice(0, 8).join(", ")}`, "SCHEDULE_FIXTURES_UNSCHEDULED", {
      fixtureIds: coverage.missingFixtureIds,
      totalCount: coverage.requiredCount,
      scheduledCount: coverage.scheduledCount,
      unscheduledCount: coverage.missingFixtureIds.length,
    });
  }
}

export function projectOfficialScheduleEntry(schedule: Schedule, venue: string): DemoScheduleEntry {
  return {
    scheduledAt: scheduleLocalDateTime(schedule.scheduledDate).slice(0, 19),
    durationMinutes: schedule.durationMinutes,
    venue,
    refereeNames: [],
    notes: schedule.notes ?? "",
    ...(schedule.slotId ? { slotId: schedule.slotId } : {}),
    locked: schedule.isLocked,
    officialStatus: schedule.status,
  };
}

export function assertOfficialScheduleCanRegenerate(schedules: Array<Pick<Schedule, "status">>): void {
  if (schedules.some((schedule) => schedule.status === "PUBLISHED")) {
    throw new AppError(409, "Lịch đã công bố; không được tạo lại phương án hoặc ghi đè lịch chính thức.", "PUBLISHED_SCHEDULE_IMMUTABLE");
  }
}

/** Shared planner contracts use the competition's wall clock when checking date and hour windows. */
export function scheduleLocalDateTime(value: string): string {
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value}+07:00` : value;
  const time = new Date(zoned).getTime();
  if (!Number.isFinite(time)) throw new AppError(400, "Ngày giờ thi đấu không hợp lệ", "INVALID_DATE");
  return `${new Date(time + 7 * 60 * 60_000).toISOString().slice(0, 19)}+07:00`;
}

export function assertOfficialEntriesUnchanged(
  current: Record<string, DemoScheduleEntry>,
  candidate: Record<string, DemoScheduleEntry>,
): void {
  for (const [fixtureId, entry] of Object.entries(current)) {
    if (!entry.locked && entry.officialStatus !== "PUBLISHED") continue;
    const next = candidate[fixtureId];
    if (!next || scheduleLocalDateTime(next.scheduledAt) !== scheduleLocalDateTime(entry.scheduledAt)
      || next.venue !== entry.venue || next.durationMinutes !== entry.durationMinutes) {
      throw new AppError(409, `Trận ${fixtureId} đã khóa hoặc đã công bố; không được ghi đè lịch.`, "SCHEDULE_LOCKED", { fixtureId });
    }
  }
}

export async function saveOfficialScheduleDraft(tournamentId: string, value: unknown, baseSignature: unknown, changedBy: string) {
  const context = await getOfficialScheduleContext(tournamentId);
  if (!context.resources || !context.fixtures.length) throw new AppError(409, "Cần sơ đồ đã công bố và cấu hình sân đã lưu", "SCHEDULE_RESOURCES_REQUIRED");
  if (typeof baseSignature !== "string" || baseSignature !== context.baseSignature) throw new AppError(409, "Lịch hoặc cấu hình đã thay đổi. Tải lại trước khi lưu.", "SCHEDULE_REVISION_CONFLICT");
  const entries = parseOfficialScheduleEntries(value, context.fixtures, context.resources, context.entries);
  assertOfficialEntriesUnchanged(context.entries, entries);
  const issues = validateSchedulePlan(context.fixtures, entries, context.resources, context.pitchType).filter((issue) => issue.severity !== "WARNING");
  issues.push(...validateScheduleSetupAgainstTournament(context.tournamentContext, context.resources, context.fixtures).map((message) => ({ fixtureId: "", code: "REGULATION_SETUP", message, severity: "HARD" as const })));
  if (issues.length) throw new AppError(409, issues[0].message, "SCHEDULE_VALIDATION_FAILED", { issues });
  const teamIds = [...new Set(context.fixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id))))];
  const inputs = Object.entries(entries).filter(([, entry]) => entry.scheduledAt).map(([matchId, entry]) => {
    const fixture = context.fixtures.find((item) => item.id === matchId)!;
    const venue = context.resources!.venues.find((item) => item.code === entry.venue || item.name === entry.venue)!;
    return { tournamentId, matchId, venueId: venue.id, scheduledDate: scheduleLocalDateTime(entry.scheduledAt), durationMinutes: matchPlayMinutes(fixture, context.resources!), notes: entry.notes, slotId: entry.slotId, locked: entry.locked };
  });
  for (const input of inputs) {
    const { matchDate, endDate } = await assertScheduleDateAndMatch(input);
    const venue = await getVenue(input.venueId);
    if (!venue.isActive) throw new AppError(409, "Sân đã ngừng hoạt động", "VENUE_NOT_ACTIVE");
    if (!await isVenueAvailableDuring(input.venueId, matchDate, endDate)) throw new AppError(409, "Sân không khả dụng trong khoảng thời gian này", "VENUE_UNAVAILABLE");
  }
  await saveScheduleDraftBatch(tournamentId, inputs, changedBy, teamIds, async () => {
    const latest = await getOfficialScheduleContext(tournamentId);
    if (latest.baseSignature !== baseSignature) throw new AppError(409, "Lịch hoặc cấu hình đã thay đổi ở phiên khác.", "SCHEDULE_REVISION_CONFLICT");
  });
  return getOfficialScheduleContext(tournamentId);
}

export function parseOfficialScheduleEntries(value: unknown, fixtures: DemoFixture[], resources: DemoScheduleResources, currentEntries: Record<string, DemoScheduleEntry> = {}): Record<string, DemoScheduleEntry> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 512) throw new AppError(400, "Danh sách lịch không hợp lệ", "INVALID_SCHEDULE_ENTRIES");
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  const entries: Record<string, DemoScheduleEntry> = {};
  for (const [fixtureId, raw] of Object.entries(value)) {
    if (!fixtureIds.has(fixtureId) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError(400, "Lịch tham chiếu trận không thuộc sơ đồ đã công bố", "OFFICIAL_FIXTURE_REQUIRED");
    const entry = raw as DemoScheduleEntry;
    if (!entry.scheduledAt) continue;
    if (typeof entry.scheduledAt !== "string" || typeof entry.venue !== "string" || !resources.venues.some((venue) => venue.code === entry.venue || venue.name === entry.venue)) throw new AppError(400, `Ngày giờ hoặc sân trận ${fixtureId} không hợp lệ`, "INVALID_SCHEDULE_ENTRIES");
    const fixture = fixtures.find((item) => item.id === fixtureId)!;
    const duration = matchPlayMinutes(fixture, resources);
    const previous = currentEntries[fixtureId];
    const correctableDraftDuration = previous && !previous.locked && previous.officialStatus !== "PUBLISHED" && entry.durationMinutes === previous.durationMinutes;
    if (entry.durationMinutes !== null && entry.durationMinutes !== undefined && entry.durationMinutes !== duration && !correctableDraftDuration) throw new AppError(409, `Thời lượng trận ${fixtureId} phải theo điều kiện đã lưu (${duration} phút).`, "SCHEDULE_DURATION_MISMATCH");
    entries[fixtureId] = { scheduledAt: scheduleLocalDateTime(entry.scheduledAt).slice(0, 19), durationMinutes: duration, venue: entry.venue, refereeNames: [], notes: typeof entry.notes === "string" ? entry.notes.slice(0, 2_000) : "", ...(typeof entry.slotId === "string" ? { slotId: entry.slotId } : {}), ...(typeof entry.locked === "boolean" ? { locked: entry.locked } : {}) };
  }
  return entries;
}

export async function publishTournamentSchedules(tournamentId: string, changedBy: string) {
  const context = await getOfficialScheduleContext(tournamentId);
  if (!context.resources) throw new AppError(409, "Cần lưu cấu hình sân và thời gian trước khi công bố lịch", "SCHEDULE_RESOURCES_REQUIRED");
  const requiredFixtures = context.fixtures.filter((fixture) => !fixture.bye);
  const schedules = context.schedules;
  assertOfficialSchedulePublicationComplete(requiredFixtures, schedules);
  const scheduleByMatch = new Map(schedules.filter((schedule) => schedule.status !== "CANCELLED").map((schedule) => [schedule.matchId, schedule]));
  const validation = validateSchedulePlan(requiredFixtures, context.entries, context.resources, context.pitchType)
    .filter((issue) => issue.severity !== "WARNING");
  validation.push(...validateScheduleSetupAgainstTournament(context.tournamentContext, context.resources, requiredFixtures).map((message) => ({ fixtureId: "", code: "REGULATION_SETUP", message, severity: "HARD" as const })));
  if (validation.length) throw new AppError(409, validation[0].message, "SCHEDULE_PUBLICATION_CONFLICT", { issues: validation });
  for (const schedule of requiredFixtures.map((fixture) => scheduleByMatch.get(fixture.id)!).filter((item) => item.status !== "PUBLISHED")) {
    const result = await checkConflicts({
      tournamentId,
      matchId: schedule.matchId,
      venueId: schedule.venueId,
      scheduledDate: schedule.scheduledDate,
      durationMinutes: schedule.durationMinutes,
    }, schedule.id);
    if (result.hasConflict) {
      throw new AppError(409, `Lịch trận ${schedule.matchId} không hợp lệ: ${result.conflicts[0]?.reason ?? "có xung đột"}`, "SCHEDULE_PUBLICATION_CONFLICT", { scheduleId: schedule.id, conflicts: result.conflicts });
    }
  }
  const teamIds = [...new Set(requiredFixtures.flatMap((fixture) => [fixture.homeTeamId, fixture.awayTeamId].filter((id): id is string => Boolean(id))))];
  // Match Service owns both databases. Synchronize display metadata in one transaction,
  // keeping the scheduling database as the authoritative publication record.
  const matchClient = await getMatchPool().connect();
  let matchMetadataCommitted = false;
  const previousMatches: Array<{ id: string; match_date: Date | null; venue: string | null; status: string }> = [];
  let publishedCount: number;
  try {
    publishedCount = await publishScheduleBatch(tournamentId, requiredFixtures.map((fixture) => fixture.id), changedBy, teamIds, async () => {
      const latest = await getOfficialScheduleContext(tournamentId);
      if (latest.baseSignature !== context.baseSignature || latest.diagramVersion !== context.diagramVersion) throw new AppError(409, "Lịch hoặc sơ đồ đã thay đổi trước khi công bố. Tải lại để kiểm tra.", "SCHEDULE_REVISION_CONFLICT");
      assertOfficialSchedulePublicationComplete(latest.fixtures, latest.schedules);
      for (const schedule of schedules.filter((item) => item.status === "DRAFT")) {
        const conflict = await checkConflicts({ tournamentId, matchId: schedule.matchId, venueId: schedule.venueId, scheduledDate: schedule.scheduledDate, durationMinutes: schedule.durationMinutes }, schedule.id);
        if (conflict.hasConflict) throw new AppError(409, `Lịch trận ${schedule.matchId} không hợp lệ`, "SCHEDULE_PUBLICATION_CONFLICT", { conflicts: conflict.conflicts });
      }
      await matchClient.query("BEGIN");
      const rows = await matchClient.query<{ id: string; match_date: Date | null; venue: string | null; status: string }>("SELECT id,match_date,venue,status FROM matches WHERE tournament_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE", [tournamentId, requiredFixtures.map((fixture) => fixture.id)]);
      if (rows.rowCount !== requiredFixtures.length) throw new AppError(409, "Danh sách trận đã thay đổi", "OFFICIAL_FIXTURE_REQUIRED");
      previousMatches.push(...rows.rows);
      for (const fixture of requiredFixtures) {
        const schedule = scheduleByMatch.get(fixture.id)!;
        const venue = await getVenue(schedule.venueId);
        await matchClient.query("UPDATE matches SET match_date=$2,venue=$3,status=CASE WHEN status IN ('UNSCHEDULED','POSTPONED') THEN 'SCHEDULED' ELSE status END,updated_at=NOW() WHERE id=$1", [fixture.id, schedule.scheduledDate, venue.name]);
      }
      await matchClient.query("COMMIT");
      matchMetadataCommitted = true;
    });
  } catch (error) {
    if (!matchMetadataCommitted) await matchClient.query("ROLLBACK");
    else {
      await matchClient.query("BEGIN");
      for (const row of previousMatches) await matchClient.query("UPDATE matches SET match_date=$2,venue=$3,status=$4,updated_at=NOW() WHERE id=$1", [row.id, row.match_date, row.venue, row.status]);
      await matchClient.query("COMMIT");
    }
    throw error;
  } finally { matchClient.release(); }
  const savedSchedules = await getSchedulesForManager(tournamentId);
  const notificationFailures: string[] = [];
  if (publishedCount > 0) {
    const newlyPublishedIds = new Set(schedules.filter((schedule) => schedule.status === "DRAFT").map((schedule) => schedule.id));
    await Promise.all(savedSchedules.filter((schedule) => newlyPublishedIds.has(schedule.id) && schedule.status === "PUBLISHED").map(async (schedule) => {
      try { notificationFailures.push(...await notifyScheduleChange(schedule, await getMatch(schedule.matchId))); }
      catch { notificationFailures.push(`schedule:${schedule.id}`); }
    }));
  }
  return { publishedCount, totalCount: requiredFixtures.length, schedules: savedSchedules, notificationFailures };
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

async function authInternal(path: string): Promise<Response> {
  if (!schedulingConfig.internalApiKey) {
    throw new AppError(503, "Internal service authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  try {
    return await fetch(new URL(path, matchConfig.authServiceUrl), {
      headers: { "x-gateway-internal-key": schedulingConfig.internalApiKey },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new AppError(503, "Authentication service is unavailable", "UPSTREAM_UNAVAILABLE");
  }
}

export async function searchRefereeCandidates(search: string): Promise<RefereeCandidate[]> {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  const response = await authInternal(`/internal/referee-accounts${query.size ? `?${query}` : ""}`);
  if (!response.ok) throw new AppError(502, "Referee directory could not be loaded", "UPSTREAM_ERROR");
  const body = await response.json() as { users?: RefereeCandidate[] };
  return Array.isArray(body.users) ? body.users : [];
}

async function assertActiveReferee(refereeId: string): Promise<void> {
  const response = await authInternal(`/internal/users/${encodeURIComponent(refereeId)}/organizational-access`);
  if (response.status === 404) throw new AppError(400, "Assigned account does not exist", "REFEREE_NOT_FOUND");
  if (!response.ok) throw new AppError(502, "Referee eligibility could not be verified", "UPSTREAM_ERROR");
  const user = await response.json() as { roles?: string[]; isActive?: boolean; emailVerified?: boolean };
  if (!user.isActive || !user.emailVerified || !user.roles?.includes("REFEREE")) {
    throw new AppError(400, "Each assigned official must be an active, verified REFEREE account", "INVALID_REFEREE");
  }
}

export async function getScheduleOfficials(scheduleId: string): Promise<ScheduleRefereeAssignment[]> {
  return listScheduleRefereeAssignments(scheduleId);
}

export async function getScheduleOfficialsHistory(scheduleId: string): Promise<ScheduleRefereeAssignmentHistory[]> {
  return listScheduleRefereeAssignmentHistory(scheduleId);
}

export async function getScheduleChangesHistory(scheduleId: string): Promise<ScheduleChangeHistory[]> {
  return listScheduleChangeHistory(scheduleId);
}

export async function assignScheduleOfficials(
  scheduleId: string,
  assignments: ScheduleRefereeAssignmentInput[],
  changedBy: string,
  reason?: string,
): Promise<{ assignments: ScheduleRefereeAssignment[]; notificationFailures: string[] }> {
  const schedule = await getSchedule(scheduleId);
  validateCrewAssignments(assignments, await configuredPositionsForMatch(schedule.tournamentId, schedule.matchId));
  const before = await listScheduleRefereeAssignments(scheduleId);
  const changesExistingAssignment = before.some((current) => !assignments.some((next) =>
    next.refereeId === current.refereeId &&
    next.position === current.position &&
    (next.isFinalAuthority === true) === current.isFinalAuthority
  ));
  if (schedule.status === "PUBLISHED" && assignments.length === 0) {
    throw new AppError(409, "A published schedule must keep at least one assigned official", "FINAL_AUTHORITY_REQUIRED");
  }
  if (schedule.status === "PUBLISHED" && changesExistingAssignment && !reason?.trim()) {
    throw new AppError(400, "A reason is required when changing an already published crew", "CHANGE_REASON_REQUIRED");
  }
  const match = await getMatch(schedule.matchId);
  if (!["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(match.status)) {
    throw new AppError(409, "The crew cannot be changed after match operations have started", "CREW_LOCKED");
  }
  await Promise.all(assignments.map((assignment) => assertActiveReferee(assignment.refereeId)));
  for (const assignment of assignments) {
    const conflicts = await checkRefereeConflicts(
      assignment.refereeId,
      schedule.scheduledDate,
      schedule.durationMinutes,
      schedule.id,
    );
    if (conflicts.length) {
      throw new AppError(409, `Referee ${assignment.refereeId} is already assigned to an overlapping match`, "REFEREE_CONFLICT");
    }
  }
  const saved = await replaceScheduleRefereeAssignments(scheduleId, assignments, changedBy, reason);
  const beforeByUser = new Map(before.map((item) => [item.refereeId, item]));
  const afterByUser = new Map(saved.map((item) => [item.refereeId, item]));
  const changedUserIds = new Set([
    ...before.filter((item) => {
      const next = afterByUser.get(item.refereeId);
      return !next || next.position !== item.position || next.isFinalAuthority !== item.isFinalAuthority;
    }).map((item) => item.refereeId),
    ...saved.filter((item) => {
      const previous = beforeByUser.get(item.refereeId);
      return !previous || previous.position !== item.position || previous.isFinalAuthority !== item.isFinalAuthority;
    }).map((item) => item.refereeId),
  ]);
  const notificationFailures: string[] = [];
  for (const userId of changedUserIds) {
    try {
      const assignment = afterByUser.get(userId);
      const response = await fetch(new URL("/internal/notifications", matchConfig.notificationServiceUrl), {
        method: "POST",
        headers: { "content-type": "application/json", "x-internal-api-key": schedulingConfig.internalApiKey },
        body: JSON.stringify({
          userId,
          type: "SYSTEM",
          title: assignment ? "Bạn được phân công điều hành trận đấu" : "Phân công trọng tài đã được thay đổi",
          body: assignment
            ? `Bạn được phân công vị trí ${assignment.position} cho trận ${schedule.matchId}, ngày ${new Date(schedule.scheduledDate).toLocaleString("vi-VN")}.${assignment.isFinalAuthority ? " Bạn là người xác nhận kết quả cuối cùng." : ""}`
            : `Phân công của bạn cho trận ${schedule.matchId} đã được thu hồi${reason ? `: ${reason}` : "."}`,
          data: { category: "MATCH_OFFICIAL_ASSIGNMENT", scheduleId, matchId: schedule.matchId, position: assignment?.position ?? null },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) notificationFailures.push(userId);
    } catch {
      notificationFailures.push(userId);
    }
  }
  return { assignments: saved, notificationFailures };
}

export async function refereeIsAssignedToMatch(
  matchId: string,
  refereeId: string,
): Promise<boolean> {
  return isRefereeAssignedToMatch(matchId, refereeId);
}

export async function getRefereeAssignmentForMatch(matchId: string, refereeId: string): Promise<ScheduleRefereeAssignment | null> {
  return findRefereeAssignmentForMatch(matchId, refereeId);
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

  const officialResources = await getTournamentSchedulingResources(input.tournamentId);
  if (officialResources) {
    const context = await getOfficialScheduleContext(input.tournamentId);
    if (!context.resources) throw new AppError(409, "Thiếu cấu hình sân và thời gian đã lưu cho giải", "SCHEDULE_RESOURCES_REQUIRED");
    const candidateVenue = context.resources.venues.find((item) => item.id === input.venueId);
    if (!candidateVenue || !candidateVenue.active || !candidateVenue.availabilityConfirmed) {
      throw new AppError(409, "Sân chưa được xác nhận khả dụng trong cấu hình lập lịch của giải", "VENUE_AVAILABILITY_UNCONFIRMED");
    }
    const candidateEntries = {
      ...context.entries,
      [input.matchId]: {
        scheduledAt: scheduleLocalDateTime(matchDate.toISOString()).slice(0, 19),
        durationMinutes: input.durationMinutes ?? 90,
        venue: candidateVenue.code,
        refereeNames: [],
        notes: "",
        locked: false,
      },
    };
    const issues = validateSchedulePlan(context.fixtures, candidateEntries, context.resources, context.pitchType)
      .filter((issue) => issue.severity !== "WARNING");
    if (issues.length) {
      conflicts.push(...issues.map((issue) => ({ type: "venue" as const, scheduleId: issue.fixtureId, reason: issue.message })));
    }
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
  if (input.refereeId) await assertActiveReferee(input.refereeId);
  // Check conflicts
  const conflictCheck = await checkConflicts(input);
  if (conflictCheck.hasConflict) {
    throw new AppError(409, conflictCheck.conflicts.map((item) => item.reason).join(" ") || "Schedule conflicts detected", "CONFLICT_DETECTED", { conflicts: conflictCheck.conflicts });
  }
  const existing = await findScheduleByMatchId(input.matchId);
  if (existing && existing.status !== "CANCELLED") {
    throw new AppError(409, "A non-cancelled schedule already exists for this match", "SCHEDULE_ALREADY_EXISTS");
  }
  const [match, tournament] = await Promise.all([
    getMatch(input.matchId),
    getTournamentScheduleSettings(input.tournamentId),
  ]);
  const minimumRestMinutes = tournament.rules?.minimumRestMinutes ?? schedulingConfig.minRestMinutes;
  const possibleTeamIds = await getKnockoutMatchPossibleEntrants(input.matchId)
    ?? [match.homeTeamId, match.awayTeamId].filter((teamId): teamId is string => Boolean(teamId));
  return createSchedule(input, createdBy, {
    teamIds: possibleTeamIds,
    refereeIds: input.refereeId ? [input.refereeId] : [],
    minimumRestMinutes,
  }, () => assertTeamRestAvailable(input, undefined, minimumRestMinutes));
}

export async function updateScheduleInfo(id: string, input: ScheduleUpdateInput, changedBy: string): Promise<{ schedule: Schedule; notificationFailures: string[] }> {
  const existing = await findScheduleById(id);
  if (!existing) {
    throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  }
  if (input.refereeId !== undefined) {
    throw new AppError(400, "Use the per-match referee crew assignment endpoint to change officials", "CREW_ASSIGNMENT_ENDPOINT_REQUIRED");
  }

  const [match, tournament, activeOfficials] = await Promise.all([
    getMatch(existing.matchId),
    getTournamentScheduleSettings(existing.tournamentId),
    listScheduleRefereeAssignments(id),
  ]);
  if (!await isFixtureMatchPublic(match.id)) {
    throw new AppError(409, "Chỉ được cập nhật lịch cho fixture đã công bố", "PUBLISHED_FIXTURE_REQUIRED");
  }
  const possibleTeamIds = await getKnockoutMatchPossibleEntrants(existing.matchId)
    ?? [match.homeTeamId, match.awayTeamId].filter((teamId): teamId is string => Boolean(teamId));
  const guard = {
    teamIds: possibleTeamIds,
    refereeIds: activeOfficials.map((assignment) => assignment.refereeId),
    minimumRestMinutes: tournament.rules?.minimumRestMinutes ?? schedulingConfig.minRestMinutes,
  };

  const changesPublishedSchedule = existing.status === "PUBLISHED" && (
    input.venueId !== undefined || input.scheduledDate !== undefined ||
    input.durationMinutes !== undefined || input.status !== undefined
  );
  if (changesPublishedSchedule && (input.reason?.trim().length ?? 0) < 10) {
    throw new AppError(400, "A reason of at least 10 characters is required to change a published schedule", "CHANGE_REASON_REQUIRED");
  }
  if (changesPublishedSchedule && ["IN_PROGRESS", "FINISHED", "VERIFIED"].includes(match.status)) {
    throw new AppError(409, "A match that has started or finished cannot be rescheduled", "MATCH_SCHEDULE_LOCKED");
  }
  if (input.status === "RESCHEDULED") {
    throw new AppError(400, "Keep the schedule published when assigning its replacement time; use the change history to record the reschedule", "INVALID_SCHEDULE_TRANSITION");
  }

  const validationInput: ScheduleCreateInput = {
    tournamentId: existing.tournamentId,
    matchId: existing.matchId,
    venueId: input.venueId ?? existing.venueId,
    refereeId: input.refereeId ?? existing.refereeId ?? undefined,
    scheduledDate: input.scheduledDate ?? existing.scheduledDate,
    durationMinutes: input.durationMinutes ?? existing.durationMinutes,
  };

  if (
    input.venueId ||
    input.scheduledDate ||
    input.refereeId ||
    input.durationMinutes !== undefined ||
    input.status === "PUBLISHED"
  ) {
    const conflictCheck = await checkConflicts(validationInput, id);
    if (conflictCheck.hasConflict) {
      throw new AppError(409, "Schedule conflicts detected", "CONFLICT_DETECTED");
    }
  }

  const validateTeamRest = () => assertTeamRestAvailable(
    validationInput,
    id,
    guard.minimumRestMinutes,
  );
  const updated = await updateSchedule(id, input, guard, validateTeamRest, changedBy);
  if (!updated) {
    throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  }
  const publishedScheduleChanged = updated.status === "PUBLISHED" && (
    existing.status !== "PUBLISHED" || updated.scheduledDate !== existing.scheduledDate ||
    updated.venueId !== existing.venueId || updated.durationMinutes !== existing.durationMinutes
  );
  if (publishedScheduleChanged) {
    const match = await getMatch(updated.matchId);
    try {
      const venue = await getVenue(updated.venueId);
      if (!venue) throw new AppError(409, "Sân thi đấu không còn tồn tại", "VENUE_NOT_FOUND");
      await updateMatchInfo(updated.matchId, {
        matchDate: updated.scheduledDate,
        venue: venue.name,
        ...(match.status === "UNSCHEDULED" || match.status === "POSTPONED"
          ? { status: "SCHEDULED" as const }
          : {}),
      });
    } catch (error) {
      await updateSchedule(id, { status: "DRAFT", reason: "Rollback after match date synchronization failed" }, guard, validateTeamRest, changedBy);
      throw error;
    }
  }
  if (updated.status === "CANCELLED" && existing.status === "PUBLISHED") {
    try {
      await updateMatchInfo(updated.matchId, { status: "POSTPONED" });
    } catch (error) {
      await updateSchedule(id, { status: "PUBLISHED", reason: "Rollback after match postponement synchronization failed" }, guard, validateTeamRest, changedBy);
      throw error;
    }
  }
  const notificationFailures = publishedScheduleChanged || (updated.status === "CANCELLED" && existing.status === "PUBLISHED")
    ? await notifyScheduleChange(updated, await getMatch(updated.matchId), input.reason)
    : [];
  return { schedule: updated, notificationFailures };
}

export async function removeSchedule(id: string): Promise<void> {
  const existing = await findScheduleById(id);
  if (!existing) {
    throw new AppError(404, "Schedule not found", "SCHEDULE_NOT_FOUND");
  }

  if (existing.status !== "DRAFT") {
    throw new AppError(409, "Published or cancelled schedules must remain in history; cancel or reschedule instead of deleting", "SCHEDULE_DELETE_NOT_ALLOWED");
  }

  await deleteSchedule(id);
}

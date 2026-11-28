import type {
  Tournament,
  TournamentCreateInput,
  RankingCriterion,
  TournamentUpdateInput,
  RegistrationPeriod,
  RegistrationPeriodCreateInput,
  Regulation,
  RegulationCreateInput,
  RegulationUpdateInput,
  TournamentStatus,
} from "../models/tournament";
import { AppError } from "../lib/errors";
import { config } from "../config";
import { isWithinAnyRegistrationPeriod, toRegistrationTimestamp } from "./registrationPeriod";
import { isTeamRosterReady } from "./rosterReadiness";
import { assertLockedTeamCountFitsFormat, assertRegistrationQueueCanBeLocked } from "./registrationQueueReadiness";
import { getPublishedDrawVersion } from "../repositories/drawWorkflowRepository";
import {
  findTournamentById,
  listTournaments,
  createTournament,
  updateTournament,
  lockTournamentRosterSnapshot,
  deleteTournament,
  listRegistrationPeriods,
  createRegistrationPeriod,
  deleteRegistrationPeriod,
  listRegulations,
  findRegulationById,
  createRegulation,
  updateRegulation,
  deleteRegulation,
  closeExpiredTournamentRegistrations,
  setManualRegistrationStatus,
} from "../repositories/tournamentRepository";

export async function closeExpiredRegistrations(): Promise<number> {
  return closeExpiredTournamentRegistrations();
}

export function isManualRegistrationControlEnabled(
  nodeEnv = config.nodeEnv,
  featureEnabled = config.enableManualRegistrationControl,
): boolean {
  return featureEnabled && ["development", "test"].includes(nodeEnv);
}

export async function manuallyControlRegistration(input: {
  tournamentId: string;
  actorId: string;
  action: "TEST_CLOSE" | "TEST_REOPEN";
}): Promise<Tournament> {
  if (!isManualRegistrationControlEnabled()) {
    throw new AppError(404, "Test registration controls are unavailable", "TEST_REGISTRATION_CONTROL_DISABLED");
  }
  return setManualRegistrationStatus(input);
}

export async function getTournament(id: string): Promise<Tournament> {
  const tournament = await findTournamentById(id);
  if (!tournament) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  return tournament;
}

export async function assertRegistrationOpen(
  tournamentId: string,
  institutionId: string | null,
  institutionType?: "UNIVERSITY" | "COLLEGE",
): Promise<Tournament> {
  const tournament = await getTournament(tournamentId);
  if (tournament.status !== "OPEN_REGISTRATION") {
    throw new AppError(409, "Tournament registration is not open", "REGISTRATION_CLOSED");
  }

  if (!isWithinAnyRegistrationPeriod(tournament.registrationPeriods, Date.now())) {
    throw new AppError(409, "There is no active registration period", "REGISTRATION_CLOSED");
  }

  assertInstitutionEligibleForTournament(tournament, institutionId, institutionType);
  return tournament;
}

export function assertInstitutionEligibleForTournament(
  tournament: Tournament,
  institutionId: string | null,
  institutionType?: "UNIVERSITY" | "COLLEGE",
): void {
  const allowedInstitutions = tournament.allowedInstitutionIds ?? [];
  const allowedLevels = tournament.allowedInstitutionLevels ?? ["UNIVERSITY", "COLLEGE"];
  const allInstitutionsAllowed = tournament.allInstitutionsAllowed ??
    allowedInstitutions.length === 0;
  if (!institutionId) {
    throw new AppError(409, "The team must be linked to a school before registration", "INSTITUTION_REQUIRED");
  }
  if (tournament.scope === "SINGLE_INSTITUTION" && !allowedInstitutions.includes(institutionId)) {
    throw new AppError(403, "Only clubs from the organizing school may join this internal tournament", "INSTITUTION_NOT_ALLOWED");
  }
  if (
    tournament.scope === "INTER_SCHOOL" &&
    ((!allInstitutionsAllowed && !allowedInstitutions.includes(institutionId)) ||
      (institutionType && !allowedLevels.includes(institutionType)))
  ) {
    throw new AppError(403, "The team institution is not eligible for this tournament", "INSTITUTION_NOT_ALLOWED");
  }
}

export async function getTournaments(
  limit: number,
  offset: number,
  status?: string,
  filters: {
    statuses?: string[];
    search?: string;
    scope?: "SINGLE_INSTITUTION" | "INTER_SCHOOL";
    institutionId?: string;
    fromDate?: string;
    toDate?: string;
    sortBy?: "CREATED_AT" | "NAME" | "START_DATE";
    sortOrder?: "ASC" | "DESC";
    draftCreatorId?: string;
  } = {},
): Promise<{ items: Tournament[]; total: number }> {
  return listTournaments(limit, offset, status, filters);
}

export async function createNewTournament(
  input: TournamentCreateInput,
): Promise<Tournament> {
  const requiredText: Array<[string, string]> = [
    [input.name, "name"],
    [input.location, "location"],
    [input.organizerName, "organizerName"],
    [input.organizerContactName, "organizerContactName"],
    [input.organizerEmail, "organizerEmail"],
    [input.createdBy, "createdBy"],
  ];
  if (requiredText.some(([value]) => typeof value !== "string" || !value.trim())) {
    throw new AppError(400, "Required tournament information is missing", "INVALID_TOURNAMENT_DETAILS");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.organizerEmail)) {
    throw new AppError(400, "Organizer email is invalid", "INVALID_ORGANIZER_EMAIL");
  }
  if (typeof input.eligibilityDescription !== "string") {
    throw new AppError(400, "Eligibility description must be text", "INVALID_ELIGIBILITY_DESCRIPTION");
  }
  if (!["SINGLE_INSTITUTION", "INTER_SCHOOL"].includes(input.scope)) {
    throw new AppError(400, "Tournament scope is invalid", "INVALID_TOURNAMENT_SCOPE");
  }
  if (![5, 7, 11].includes(input.footballFormat)) {
    throw new AppError(400, "Football format must be 5, 7, or 11 players", "INVALID_FOOTBALL_FORMAT");
  }
  if (!["ROUND_ROBIN", "GROUP_AND_KNOCKOUT", "KNOCKOUT"].includes(input.competitionFormat)) {
    throw new AppError(400, "Competition format is invalid", "INVALID_COMPETITION_FORMAT");
  }
  if (![1, 2].includes(input.roundRobinLegs)) {
    throw new AppError(400, "Vòng tròn phải thi đấu một hoặc hai lượt", "INVALID_ROUND_ROBIN_LEGS");
  }
  const config = input.competitionConfig;
  if (!config || !["AUTO_BY_CAPACITY", "FIXED"].includes(config.groupCountMode) ||
      !["BALANCED", "TOP_UP_FIRST"].includes(config.groupAllocation) ||
      !["NONE", "PREFER_SEPARATE", "REQUIRE_SEPARATE"].includes(config.sameInstitutionPolicy) ||
      !["GROUP_RANK", "REDRAW", "FIXED_CROSSOVER"].includes(config.knockoutPairing) ||
      !["AUTOMATIC", "SEEDED_FIRST"].includes(config.byePolicy) ||
      ![1, 2].includes(config.knockoutLegs) || typeof config.thirdPlaceMatch !== "boolean") {
    throw new AppError(400, "Cấu hình thể thức không hợp lệ", "INVALID_COMPETITION_CONFIG");
  }
  const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timePattern.test(config.schedulingStartTime) || !timePattern.test(config.schedulingEndTime) || config.schedulingStartTime >= config.schedulingEndTime) {
    throw new AppError(400, "Khung giờ thi đấu phải hợp lệ và giờ kết thúc phải sau giờ bắt đầu", "INVALID_SCHEDULING_WINDOW");
  }
  if (!["PENALTIES_ONLY", "EXTRA_TIME_THEN_PENALTIES"].includes(input.knockoutDecisionMethod)) {
    throw new AppError(400, "Quy tắc phân định thắng thua không hợp lệ", "INVALID_KNOCKOUT_DECISION_METHOD");
  }
  if (!Number.isInteger(input.extraTimeMinutes) || input.extraTimeMinutes < 1 || input.extraTimeMinutes > 60) {
    throw new AppError(400, "Thời lượng hiệp phụ phải từ 1 đến 60 phút", "INVALID_EXTRA_TIME_DURATION");
  }
  if (!Number.isInteger(input.plannedPitchCount) || input.plannedPitchCount < 1 || input.plannedPitchCount > 30) {
    throw new AppError(400, "Số sân dự kiến phải từ 1 đến 30", "INVALID_PLANNED_PITCH_COUNT");
  }
  if (!Number.isFinite(input.playableHoursPerDay) || input.playableHoursPerDay < 1 || input.playableHoursPerDay > 24) {
    throw new AppError(400, "Thời gian tổ chức mỗi ngày phải từ 1 đến 24 giờ", "INVALID_PLAYABLE_HOURS");
  }
  if (input.competitionFormat === "GROUP_AND_KNOCKOUT") {
    if (!Number.isInteger(input.maxTeamsPerGroup) || input.maxTeamsPerGroup! < 3 || input.maxTeamsPerGroup! > input.maxTeams) {
      throw new AppError(400, "Số đội tối đa mỗi bảng phải từ 3 đến tổng số đội tối đa của giải", "INVALID_GROUP_CAPACITY");
    }
    if (input.advancingTeamsPerGroup < 1 || input.advancingTeamsPerGroup >= input.maxTeamsPerGroup!) {
      throw new AppError(400, "Số đội đi tiếp mỗi bảng phải nhỏ hơn sức chứa tối đa của bảng", "INVALID_GROUP_ADVANCEMENT");
    }
    if (config.groupCountMode === "FIXED" && (!Number.isInteger(config.groupCount) || config.groupCount! < 2 || config.groupCount! > Math.floor(input.maxTeams / 2) || input.maxTeams > config.groupCount! * input.maxTeamsPerGroup!)) {
      throw new AppError(400, "Số bảng cố định không thể chứa số đội tối đa theo điều lệ", "INVALID_FIXED_GROUP_COUNT");
    }
    const groupCountAtCapacity = config.groupCountMode === "FIXED" ? config.groupCount! : Math.ceil(input.maxTeams / input.maxTeamsPerGroup!);
    if (input.advancingTeamsPerGroup * groupCountAtCapacity < 2 || input.advancingTeamsPerGroup * groupCountAtCapacity > 32) {
      throw new AppError(400, "Tổng số đội đi tiếp phải từ 2 đến 32", "INVALID_PLAYOFF_FIELD_SIZE");
    }
  }
  const integerFields: Array<[number, string, number]> = [
    [input.minTeams, "minTeams", 2],
    [input.maxTeams, "maxTeams", 2],
    [input.minPlayers, "minPlayers", input.footballFormat],
    [input.maxPlayersPerTeam, "maxPlayersPerTeam", 1],
    [input.minGoalkeepers, "minGoalkeepers", 0],
    [input.pointsForWin, "pointsForWin", 0],
    [input.pointsForDraw, "pointsForDraw", 0],
    [input.pointsForLoss, "pointsForLoss", 0],
    [input.advancingTeamsPerGroup, "advancingTeamsPerGroup", 1],
    [input.yellowCardsForSuspension, "yellowCardsForSuspension", 1],
    [input.suspensionMatches, "suspensionMatches", 1],
    [input.complaintWindowHours, "complaintWindowHours", 1],
    [input.minimumRestMinutes, "minimumRestMinutes", 30],
    [input.matchDurationMinutes, "matchDurationMinutes", 1],
    [input.forfeitWinnerScore, "forfeitWinnerScore", 0],
    [input.forfeitLoserScore, "forfeitLoserScore", 0],
  ];
  const invalidInteger = integerFields.find(
    ([value, , minimum]) => !Number.isInteger(value) || value < minimum,
  );
  if (invalidInteger) {
    throw new AppError(400, `${invalidInteger[1]} is invalid`, "INVALID_TOURNAMENT_RULE");
  }
  if (input.maxTeams < input.minTeams || input.maxPlayersPerTeam < input.minPlayers || input.minGoalkeepers > input.maxPlayersPerTeam) {
    throw new AppError(400, "Minimum limits cannot exceed maximum limits", "INVALID_TOURNAMENT_LIMITS");
  }
  const dates = [input.startDate, input.endDate, input.registrationStart, input.registrationEnd];
  if (dates.some((value) => !isValidDate(value))) {
    throw new AppError(400, "Tournament and registration dates are required", "INVALID_DATES");
  }
  if (
    input.startDate > input.endDate ||
    input.registrationStart >= input.registrationEnd ||
    input.registrationEnd > input.startDate
  ) {
    throw new AppError(
      400,
      "Registration must end before the tournament starts, and tournament dates must be ordered",
      "INVALID_DATES",
    );
  }
  if (!Array.isArray(input.allowedInstitutionIds)) {
    throw new AppError(400, "Allowed institutions must be a list", "INVALID_INSTITUTIONS");
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (input.allowedInstitutionIds.some((id) => !uuidPattern.test(id))) {
    throw new AppError(400, "An allowed institution ID is invalid", "INVALID_INSTITUTIONS");
  }
  if (new Set(input.allowedInstitutionIds).size !== input.allowedInstitutionIds.length) {
    throw new AppError(400, "Allowed institutions cannot be repeated", "INVALID_INSTITUTIONS");
  }
  if (input.scope === "SINGLE_INSTITUTION" && input.allowedInstitutionIds.length !== 1) {
    throw new AppError(400, "Select exactly one institution for a single-institution tournament", "INVALID_INSTITUTIONS");
  }
  if (
    !Array.isArray(input.allowedInstitutionLevels) ||
    input.allowedInstitutionLevels.length === 0 ||
    input.allowedInstitutionLevels.some((level) => !["UNIVERSITY", "COLLEGE"].includes(level)) ||
    new Set(input.allowedInstitutionLevels).size !== input.allowedInstitutionLevels.length
  ) {
    throw new AppError(400, "Select at least one valid education level", "INVALID_INSTITUTION_LEVELS");
  }
  if (
    input.scope === "INTER_SCHOOL" &&
    !input.allInstitutionsAllowed &&
    input.allowedInstitutionIds.length === 0
  ) {
    throw new AppError(400, "Select at least one eligible school or allow all schools in the selected levels", "INVALID_INSTITUTIONS");
  }
  if (
    input.defaultMaxTeamsPerInstitution !== null &&
    (!Number.isInteger(input.defaultMaxTeamsPerInstitution) || input.defaultMaxTeamsPerInstitution < 1)
  ) {
    throw new AppError(400, "The default team limit per school must be positive or unlimited", "INVALID_INSTITUTION_LIMIT");
  }
  if (!Array.isArray(input.institutionTeamLimits)) {
    throw new AppError(400, "Per-school team limits must be a list", "INVALID_INSTITUTION_LIMIT");
  }
  const limitIds = input.institutionTeamLimits.map((limit) => limit.institutionId);
  if (
    new Set(limitIds).size !== limitIds.length ||
    input.institutionTeamLimits.some((limit) =>
      !uuidPattern.test(limit.institutionId) ||
      (limit.maxTeams !== null && (!Number.isInteger(limit.maxTeams) || limit.maxTeams < 1))
    )
  ) {
    throw new AppError(400, "One or more per-school team limits are invalid", "INVALID_INSTITUTION_LIMIT");
  }
  if (
    input.institutionTeamLimits.some((limit) =>
      !input.allInstitutionsAllowed && !input.allowedInstitutionIds.includes(limit.institutionId)
    )
  ) {
    throw new AppError(400, "A team limit refers to a school outside the tournament scope", "INVALID_INSTITUTION_LIMIT");
  }
  const rankingOptions: RankingCriterion[] = [
    "POINTS",
    "GOAL_DIFFERENCE",
    "GOALS_FOR",
    "HEAD_TO_HEAD",
    "FAIR_PLAY",
    "LOT_DRAW",
  ];
  if (
    !Array.isArray(input.rankingCriteria) ||
    input.rankingCriteria.length === 0 ||
    input.rankingCriteria[0] !== "POINTS" ||
    new Set(input.rankingCriteria).size !== input.rankingCriteria.length ||
    input.rankingCriteria.some((criterion) => !rankingOptions.includes(criterion))
  ) {
    throw new AppError(400, "Ranking criteria must be unique and start with points", "INVALID_RANKING_CRITERIA");
  }
  if (!["ORGANIZER_DECISION", "WALKOVER", "NO_AUTOMATIC_RESULT"].includes(input.forfeitPolicy)) {
    throw new AppError(400, "Forfeit policy is invalid", "INVALID_FORFEIT_POLICY");
  }

  return createTournament(input);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function updateTournamentInfo(
  id: string,
  input: TournamentUpdateInput,
  actorId?: string,
): Promise<Tournament> {
  const existing = await findTournamentById(id);
  if (!existing) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  if (
    existing.status !== "DRAFT" &&
    (input.maxTeams !== undefined || input.startDate !== undefined || input.endDate !== undefined ||
      input.competitionFormat !== undefined || input.competitionConfig !== undefined || input.roundRobinLegs !== undefined ||
      input.maxTeamsPerGroup !== undefined || input.advancingTeamsPerGroup !== undefined || input.knockoutDecisionMethod !== undefined ||
      input.extraTimeMinutes !== undefined)
  ) {
    throw new AppError(
      409,
      "Dates and team limits are locked after the tournament leaves draft; review registrations, draw and schedule impact first",
      "TOURNAMENT_STRUCTURE_LOCKED",
    );
  }

  let rosterSnapshot: RegistrationCandidate[] | undefined;
  if (input.status !== undefined && input.status !== existing.status) {
    rosterSnapshot = await assertTournamentStatusTransition(existing, input.status);
  }

  if (input.startDate && input.endDate && new Date(input.startDate) > new Date(input.endDate)) {
    throw new AppError(
      400,
      "startDate must be before or equal to endDate",
      "INVALID_DATES",
    );
  }

  if (input.maxTeams !== undefined && input.maxTeams <= 0) {
    throw new AppError(
      400,
      "maxTeams must be greater than 0",
      "INVALID_MAX_TEAMS",
    );
  }
  const format = input.competitionFormat ?? existing.competitionFormat;
  const maxTeams = input.maxTeams ?? existing.maxTeams;
  if (input.roundRobinLegs !== undefined && ![1, 2].includes(input.roundRobinLegs)) {
    throw new AppError(400, "Số lượt thi đấu phải là một hoặc hai", "INVALID_ROUND_ROBIN_LEGS");
  }
  if (input.knockoutDecisionMethod !== undefined && !["PENALTIES_ONLY", "EXTRA_TIME_THEN_PENALTIES"].includes(input.knockoutDecisionMethod)) {
    throw new AppError(400, "Quy tắc phân định thắng thua không hợp lệ", "INVALID_KNOCKOUT_DECISION_METHOD");
  }
  if (input.extraTimeMinutes !== undefined && (!Number.isInteger(input.extraTimeMinutes) || input.extraTimeMinutes < 1 || input.extraTimeMinutes > 60)) {
    throw new AppError(400, "Thời lượng hiệp phụ phải từ 1 đến 60 phút", "INVALID_EXTRA_TIME_DURATION");
  }
  if (input.competitionConfig !== undefined) {
    const config = input.competitionConfig;
    if (!["AUTO_BY_CAPACITY", "FIXED"].includes(config.groupCountMode) || !["BALANCED", "TOP_UP_FIRST"].includes(config.groupAllocation) ||
      !["NONE", "PREFER_SEPARATE", "REQUIRE_SEPARATE"].includes(config.sameInstitutionPolicy) ||
      !["GROUP_RANK", "REDRAW", "FIXED_CROSSOVER"].includes(config.knockoutPairing) || !["AUTOMATIC", "SEEDED_FIRST"].includes(config.byePolicy) ||
      ![1, 2].includes(config.knockoutLegs) || typeof config.thirdPlaceMatch !== "boolean" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.schedulingStartTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.schedulingEndTime) ||
      config.schedulingStartTime >= config.schedulingEndTime) {
      throw new AppError(400, "Cấu hình thể thức hoặc khung giờ không hợp lệ", "INVALID_COMPETITION_CONFIG");
    }
  }
  const maxTeamsPerGroup = input.maxTeamsPerGroup ?? existing.rules?.maxTeamsPerGroup ?? null;
  const advancing = input.advancingTeamsPerGroup ?? existing.rules?.advancingTeamsPerGroup ?? 2;
  if (format === "GROUP_AND_KNOCKOUT") {
    if (!Number.isInteger(maxTeamsPerGroup) || maxTeamsPerGroup! < 3 || maxTeamsPerGroup! > maxTeams) {
      throw new AppError(400, "Số đội tối đa mỗi bảng không hợp lệ", "INVALID_GROUP_CAPACITY");
    }
    if (!Number.isInteger(advancing) || advancing < 1 || advancing >= maxTeamsPerGroup!) {
      throw new AppError(400, "Số đội đi tiếp mỗi bảng không hợp lệ", "INVALID_GROUP_ADVANCEMENT");
    }
    const config = input.competitionConfig ?? existing.rules?.competitionConfig;
    const groupCount = config?.groupCountMode === "FIXED" ? config.groupCount : Math.ceil(maxTeams / maxTeamsPerGroup!);
    if (!groupCount || advancing * groupCount < 2 || advancing * groupCount > 32 || maxTeams > groupCount * maxTeamsPerGroup!) {
      throw new AppError(400, "Cấu hình số bảng không đáp ứng quy mô giải", "INVALID_PLAYOFF_FIELD_SIZE");
    }
  }

  // Business rule: cannot delete tournament in progress
  if (existing.status === "IN_PROGRESS" && input.status === "CANCELLED") {
    // Allow cancellation but may need to check with match-service in future
  }

  const updated = input.status === "ROSTER_LOCKED" && rosterSnapshot
    ? actorId
      ? await lockTournamentRosterSnapshot(id, actorId, rosterSnapshot.map(({ registrationStatus: _status, ...candidate }) => candidate))
      : (() => { throw new AppError(401, "The user performing roster lock must be identified", "UNAUTHENTICATED"); })()
    : await updateTournament(id, input, existing.status);
  if (!updated) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  if (input.status === "ROSTER_LOCKED") {
    await finalizeUnselectedOrganizationRegistrations(id);
  }
  return updated;
}

type RegistrationCandidate = {
  teamId: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  isActive: boolean;
  registrationStatus: string;
  institutionId: string | null;
  institutionName: string | null;
  institutionType: string | null;
  verifiedRosterCount: number;
  totalRosterCount: number;
  verifiedRoster: Array<Record<string, unknown>>;
};
type TournamentMatchRef = { id: string; status: string };

async function getServiceJson<T>(baseUrl: string, path: string, serviceName: string): Promise<T> {
  let endpoint: string;
  try {
    endpoint = new URL(path, baseUrl).toString();
  } catch {
    throw new AppError(503, `${serviceName} URL is invalid`, "SERVICE_MISCONFIGURED");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: config.internalApiKey ? { "x-gateway-internal-key": config.internalApiKey } : {},
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new AppError(503, `${serviceName} is unavailable`, "UPSTREAM_UNAVAILABLE");
  }
  if (!response.ok) {
    throw new AppError(502, `${serviceName} could not validate the tournament workflow`, "UPSTREAM_ERROR");
  }
  return await response.json() as T;
}

async function finalizeUnselectedOrganizationRegistrations(tournamentId: string): Promise<void> {
  try {
    const endpoint = new URL(
      `/internal/tournaments/${encodeURIComponent(tournamentId)}/finalize-unselected-registrations`,
      config.organizationServiceUrl,
    ).toString();
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.internalApiKey ? { "x-gateway-internal-key": config.internalApiKey } : {}),
      },
      body: "{}",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      console.error(`[tournament-service] roster locked, but Organization could not finalize unselected registrations (${response.status}); its retry worker will reconcile them`);
      return;
    }
    const result = await response.json() as { finalized?: number };
    console.info(`[tournament-service] finalized ${Number(result.finalized ?? 0)} unselected registrations for ${tournamentId}`);
  } catch (error) {
    console.error("[tournament-service] roster locked, but Organization finalization call failed; its retry worker will reconcile it", error);
  }
}

async function listTournamentMatches(tournamentId: string): Promise<TournamentMatchRef[]> {
  const pageSize = 100;
  const first = await getServiceJson<{ items: TournamentMatchRef[]; total: number }>(
    config.matchServiceUrl,
    `/tournaments/${encodeURIComponent(tournamentId)}/matches?limit=${pageSize}&offset=0`,
    "Match service",
  );
  if (!Array.isArray(first.items) || !Number.isInteger(first.total) || first.total < 0) {
    throw new AppError(502, "Match service returned an invalid match list", "UPSTREAM_ERROR");
  }
  const pageCount = Math.ceil(first.total / pageSize);
  const remaining = await Promise.all(Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => {
    const offset = (index + 1) * pageSize;
    return getServiceJson<{ items: TournamentMatchRef[]; total: number }>(
      config.matchServiceUrl,
      `/tournaments/${encodeURIComponent(tournamentId)}/matches?limit=${pageSize}&offset=${offset}`,
      "Match service",
    );
  }));
  const matches = [...first.items, ...remaining.flatMap((page) => page.items)];
  if (matches.length !== first.total) {
    throw new AppError(409, "The match list changed while checking tournament readiness; retry the action", "MATCH_LIST_CHANGED");
  }
  return matches;
}

async function getRegistrationReviewReadiness(tournament: Tournament): Promise<{ candidates: RegistrationCandidate[]; pendingWithdrawalCount: number; pendingApprovalReviewCount: number }> {
  const result = await getServiceJson<{ candidates: RegistrationCandidate[]; pendingWithdrawalCount: number; pendingApprovalReviewCount: number }>(
    config.organizationServiceUrl,
    `/internal/tournaments/${encodeURIComponent(tournament.id)}/registration-readiness`,
    "Organization service",
  );
  if (!Array.isArray(result.candidates) || !Number.isInteger(result.pendingWithdrawalCount) || result.pendingWithdrawalCount < 0 || !Number.isInteger(result.pendingApprovalReviewCount) || result.pendingApprovalReviewCount < 0) {
    throw new AppError(502, "Organization service returned an invalid registration list", "UPSTREAM_ERROR");
  }
  return result;
}

async function assertRegistrationReviewComplete(tournament: Tournament): Promise<RegistrationCandidate[]> {
  const result = await getRegistrationReviewReadiness(tournament);
  if (result.pendingWithdrawalCount) throw new AppError(409, `Resolve all ${result.pendingWithdrawalCount} withdrawal request(s) before opening roster lock`, "WITHDRAWAL_REQUESTS_PENDING");
  if (result.pendingApprovalReviewCount) throw new AppError(409, `Resolve all ${result.pendingApprovalReviewCount} approved-team review(s) before opening roster lock`, "APPROVAL_REVIEWS_PENDING");
  return result.candidates;
}

async function assertRosterCanBeLocked(tournament: Tournament): Promise<RegistrationCandidate[]> {
  const candidates = await assertRegistrationReviewComplete(tournament);
  assertRegistrationQueueCanBeLocked({
    statuses: candidates.map((item) => item.registrationStatus),
    minimumTeams: tournament.minTeams,
    maximumTeams: tournament.maxTeams,
  });
  const approved = candidates.filter((item) => item.registrationStatus === "APPROVED");
  assertLockedTeamCountFitsFormat({
    format: tournament.competitionFormat,
    approvedCount: approved.length,
    groupCapacity: tournament.rules?.maxTeamsPerGroup,
    groupCountMode: tournament.rules?.competitionConfig?.groupCountMode,
    fixedGroupCount: tournament.rules?.competitionConfig?.groupCount,
  });
  const invalid = approved.filter((item) =>
    !item.isActive ||
    !item.institutionId ||
    (tournament.scope === "SINGLE_INSTITUTION" && item.institutionId !== tournament.organizingInstitutionId) ||
    (!tournament.allInstitutionsAllowed && !!tournament.allowedInstitutionIds?.length && !tournament.allowedInstitutionIds.includes(item.institutionId ?? "")) ||
    (!!tournament.allowedInstitutionLevels?.length && !tournament.allowedInstitutionLevels.includes(item.institutionType as "UNIVERSITY" | "COLLEGE")) ||
    !isTeamRosterReady({
      rosterCount: item.totalRosterCount,
      listedCount: item.verifiedRoster.length,
      minimumPlayers: tournament.minPlayers,
      maximumPlayers: tournament.maxPlayersPerTeam,
      goalkeepers: item.verifiedRoster.filter((player) => player.isGoalkeeper === true).length,
      minimumGoalkeepers: tournament.minGoalkeepers,
      starters: item.verifiedRoster.filter((player) => player.lineupRole === "STARTER").length,
      requiredStarters: tournament.footballFormat,
      startingGoalkeepers: item.verifiedRoster.filter((player) => player.lineupRole === "STARTER" && player.isGoalkeeper === true).length,
    }),
  );
  if (invalid.length) {
    throw new AppError(409, `${invalid.length} approved team(s) still have an inactive team, invalid school, roster outside the allowed player count, or invalid starting lineup/goalkeeper`, "APPROVED_ROSTERS_NOT_READY");
  }
  const approvedPerInstitution = new Map<string, number>();
  for (const candidate of approved) {
    if (!candidate.institutionId) continue;
    approvedPerInstitution.set(candidate.institutionId, (approvedPerInstitution.get(candidate.institutionId) ?? 0) + 1);
  }
  const institutionLimitErrors = [...approvedPerInstitution.entries()].filter(([institutionId, count]) => {
    const customLimit = tournament.institutionTeamLimits?.find((limit) => limit.institutionId === institutionId)?.maxTeams;
    const limit = customLimit ?? tournament.defaultMaxTeamsPerInstitution;
    return limit !== null && limit !== undefined && count > limit;
  });
  if (institutionLimitErrors.length) {
    throw new AppError(409, "Approved teams exceed the configured per-school limit", "INSTITUTION_TEAM_LIMIT_EXCEEDED");
  }
  return approved;
}

async function assertSchedulesReady(tournament: Tournament): Promise<void> {
  const { readiness } = await getServiceJson<{ readiness: { canOpenOperations: boolean; stats: { total: number } } }>(
    config.matchServiceUrl, `/internal/tournaments/${encodeURIComponent(tournament.id)}/match-operation-readiness`, "Match service",
  );
  if (!readiness?.stats?.total) throw new AppError(409, "Cần sơ đồ thi đấu chính thức trước khi mở điều hành.", "FIXTURES_REQUIRED");
  if (readiness.canOpenOperations !== true) throw new AppError(409, "Chưa có trận đủ điều kiện: cần hai đội, lịch và tổ trọng tài đã công bố hợp lệ. Không yêu cầu công bố phân công toàn giải.", "SCHEDULES_NOT_READY");
}

async function assertAllMatchesFinal(tournament: Tournament): Promise<void> {
  const summary=await getServiceJson<{canComplete:boolean;blockers:Array<{code:string;message:string}>}>(config.matchServiceUrl,`/internal/tournaments/${encodeURIComponent(tournament.id)}/operations/readiness`,"Match service");
  if(!summary.canComplete)throw new AppError(409,"Giải còn trận hoặc hồ sơ chưa được giải quyết theo đúng nghiệp vụ.","MATCHES_NOT_FINAL",{blockers:summary.blockers});
}

async function assertTournamentStatusTransition(
  tournament: Tournament,
  next: TournamentStatus,
): Promise<RegistrationCandidate[] | undefined> {
  if (next === "REGISTRATION_CLOSED") {
    throw new AppError(409, "Registration closes automatically when its deadline passes", "REGISTRATION_CLOSE_AUTOMATIC");
  }
  const transitions: Partial<Record<TournamentStatus, TournamentStatus[]>> = {
    DRAFT: ["OPEN_REGISTRATION", "CANCELLED"],
    OPEN_REGISTRATION: ["CANCELLED"],
    REGISTRATION_CLOSED: ["ROSTER_LOCKED", "CANCELLED"],
    ROSTER_LOCKED: ["PREPARING", "CANCELLED"],
    PREPARING: ["IN_PROGRESS", "CANCELLED"],
    IN_PROGRESS: ["PAUSED", "COMPLETED", "CANCELLED"],
    PAUSED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  };
  if (!(transitions[tournament.status] ?? []).includes(next)) {
    throw new AppError(409, `Tournament cannot move from ${tournament.status} to ${next}`, "INVALID_TOURNAMENT_TRANSITION");
  }
  if (next === "ROSTER_LOCKED") {
    return assertRosterCanBeLocked(tournament);
  } else if (next === "PREPARING") {
    const published = await getPublishedDrawVersion(tournament.id);
    if (!published) {
      throw new AppError(409, "Publish the confirmed group draw before moving to match preparation", "PUBLISHED_DRAW_REQUIRED");
    }
  } else if (next === "IN_PROGRESS") {
    await assertSchedulesReady(tournament);
  } else if (next === "COMPLETED") {
    await assertAllMatchesFinal(tournament);
  } else if (next === "CANCELLED") {
    throw new AppError(409, "Tournament cancellation must be recorded with a reason and an audit trail", "CANCELLATION_WORKFLOW_REQUIRED");
  } else if (next === "PAUSED") {
    throw new AppError(409, "Pause the tournament through the tournament operations workflow so the reason is recorded", "PAUSE_WORKFLOW_REQUIRED");
  }
  return undefined;
}

export async function assertWorkflowStepAvailable(tournamentId: string, step: number): Promise<void> {
  const tournament = await getTournament(tournamentId);
  const highestStepByStatus: Record<TournamentStatus, number> = {
    DRAFT: 1,
    OPEN_REGISTRATION: 2,
    REGISTRATION_CLOSED: 2,
    ROSTER_LOCKED: 5,
    PREPARING: 7,
    IN_PROGRESS: 8,
    PAUSED: 8,
    COMPLETED: 8,
    CANCELLED: 1,
  };
  if (step > highestStepByStatus[tournament.status]) {
    throw new AppError(409, `Complete the required tournament stage before opening workflow step ${step}`, "WORKFLOW_STEP_LOCKED");
  }
  if (step >= 7 && !["IN_PROGRESS", "PAUSED", "COMPLETED"].includes(tournament.status)) {
    await assertSchedulesReady(tournament);
  }
  if (step >= 3 && tournament.status === "REGISTRATION_CLOSED") {
    await assertRegistrationReviewComplete(tournament);
  }
  if (step >= 5) {
    const publishedDraw = await getPublishedDrawVersion(tournamentId);
    if (!publishedDraw) {
      throw new AppError(409, "Hãy công bố kết quả bốc thăm/chia bảng trước khi mở sơ đồ thi đấu", "PUBLISHED_DRAW_REQUIRED");
    }
  }
  if (step >= 6) {
    const fixtureReadiness = await getServiceJson<{
      stages: Array<{ drawVersionId: string; stage: string; status: string; matchCount: number }>;
    }>(
      config.matchServiceUrl,
      `/internal/tournaments/${encodeURIComponent(tournamentId)}/fixture-publication-readiness`,
      "Match service",
    );
    const latestDraw = await getPublishedDrawVersion(tournamentId);
    const requiredFixtureStages = tournament.competitionFormat === "ROUND_ROBIN"
      ? ["GROUP"]
      : tournament.competitionFormat === "KNOCKOUT" ? ["KNOCKOUT"] : ["GROUP", "KNOCKOUT"];
    const publishedFixtureExists = latestDraw && requiredFixtureStages.every((requiredStage) =>
      fixtureReadiness.stages.some((stage) => stage.drawVersionId === latestDraw.id
        && stage.stage === requiredStage && stage.status === "PUBLISHED" && stage.matchCount > 0),
    );
    if (!publishedFixtureExists) {
      throw new AppError(409, "Hãy sinh và công bố sơ đồ thi đấu trước khi lập lịch", "PUBLISHED_FIXTURE_REQUIRED");
    }
  }
  // Step 8 is a review screen. The authoritative completion check runs only
  // when BTC submits the completion command, after Match has prepared its fence.
}

export async function removeTournament(id: string): Promise<void> {
  const existing = await findTournamentById(id);
  if (!existing) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }

  // Business rule: cannot delete tournament if not in DRAFT or CANCELLED
  if (existing.status !== "DRAFT" && existing.status !== "CANCELLED") {
    throw new AppError(
      400,
      "Cannot delete tournament that is not in DRAFT or CANCELLED status",
      "INVALID_STATUS_FOR_DELETION",
    );
  }

  await deleteTournament(id);
}

// Registration Periods
export async function getRegistrationPeriods(
  tournamentId: string,
): Promise<RegistrationPeriod[]> {
  const tournament = await findTournamentById(tournamentId);
  if (!tournament) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }

  return listRegistrationPeriods(tournamentId);
}

export async function createNewRegistrationPeriod(
  input: RegistrationPeriodCreateInput,
): Promise<RegistrationPeriod> {
  const tournament = await findTournamentById(input.tournamentId);
  if (!tournament) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }

  // Validation: start_date must be before end_date
  if (new Date(input.startDate) >= new Date(input.endDate)) {
    throw new AppError(
      400,
      "startDate must be before endDate",
      "INVALID_REGISTRATION_DATES",
    );
  }

  return createRegistrationPeriod({
    ...input,
    startDate: toRegistrationTimestamp(input.startDate, "start"),
    endDate: toRegistrationTimestamp(input.endDate, "end"),
  });
}

export async function removeRegistrationPeriod(id: string): Promise<void> {
  const deleted = await deleteRegistrationPeriod(id);
  if (!deleted) {
    throw new AppError(404, "Registration period not found", "REGISTRATION_PERIOD_NOT_FOUND");
  }
}

// Regulations
export async function getRegulations(tournamentId: string): Promise<Regulation[]> {
  const tournament = await findTournamentById(tournamentId);
  if (!tournament) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }

  return listRegulations(tournamentId);
}

export async function createNewRegulation(
  input: RegulationCreateInput,
): Promise<Regulation> {
  const tournament = await findTournamentById(input.tournamentId);
  if (!tournament) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  if (tournament.status !== "DRAFT") {
    throw new AppError(
      409,
      "Regulations can only be edited while the tournament is a draft",
      "REGULATIONS_LOCKED",
    );
  }

  if (!input.title.trim()) {
    throw new AppError(400, "Title is required", "INVALID_TITLE");
  }

  if (!input.content.trim()) {
    throw new AppError(400, "Content is required", "INVALID_CONTENT");
  }

  return createRegulation(input);
}

export async function updateRegulationInfo(
  id: string,
  input: RegulationUpdateInput,
): Promise<Regulation> {
  if (input.title !== undefined && !input.title.trim()) {
    throw new AppError(400, "Title is required", "INVALID_TITLE");
  }

  if (input.content !== undefined && !input.content.trim()) {
    throw new AppError(400, "Content is required", "INVALID_CONTENT");
  }

  const existing = await findRegulationById(id);
  if (!existing) {
    throw new AppError(404, "Regulation not found", "REGULATION_NOT_FOUND");
  }
  const tournament = await findTournamentById(existing.tournamentId);
  if (!tournament) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  if (tournament.status !== "DRAFT") {
    throw new AppError(
      409,
      "Regulations can only be edited while the tournament is a draft",
      "REGULATIONS_LOCKED",
    );
  }

  const updated = await updateRegulation(id, input);
  if (!updated) {
    throw new AppError(404, "Regulation not found", "REGULATION_NOT_FOUND");
  }

  return updated;
}

export async function removeRegulation(id: string): Promise<void> {
  const existing = await findRegulationById(id);
  if (!existing) {
    throw new AppError(404, "Regulation not found", "REGULATION_NOT_FOUND");
  }
  const tournament = await findTournamentById(existing.tournamentId);
  if (!tournament) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  if (tournament.status !== "DRAFT") {
    throw new AppError(
      409,
      "Regulations can only be edited while the tournament is a draft",
      "REGULATIONS_LOCKED",
    );
  }
  const deleted = await deleteRegulation(id);
  if (!deleted) {
    throw new AppError(404, "Regulation not found", "REGULATION_NOT_FOUND");
  }
}

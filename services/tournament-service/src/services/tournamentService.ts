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
import { getPublishedDrawVersion } from "../repositories/drawWorkflowRepository";
import {
  findTournamentById,
  listTournaments,
  createTournament,
  updateTournament,
  deleteTournament,
  listRegistrationPeriods,
  createRegistrationPeriod,
  deleteRegistrationPeriod,
  listRegulations,
  findRegulationById,
  createRegulation,
  updateRegulation,
  deleteRegulation,
} from "../repositories/tournamentRepository";

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

  const now = Date.now();
  const isWithinRegistrationPeriod = tournament.registrationPeriods?.some((period) => {
    const start = new Date(period.startDate).getTime();
    const end = new Date(period.endDate).getTime();
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end;
  });
  if (!isWithinRegistrationPeriod) {
    throw new AppError(409, "There is no active registration period", "REGISTRATION_CLOSED");
  }

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
  return tournament;
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
  if (![7, 11].includes(input.footballFormat)) {
    throw new AppError(400, "Football format must be 7 or 11 players", "INVALID_FOOTBALL_FORMAT");
  }
  if (!["ROUND_ROBIN", "GROUP_AND_KNOCKOUT", "KNOCKOUT"].includes(input.competitionFormat)) {
    throw new AppError(400, "Competition format is invalid", "INVALID_COMPETITION_FORMAT");
  }
  const integerFields: Array<[number, string, number]> = [
    [input.minTeams, "minTeams", 2],
    [input.maxTeams, "maxTeams", 2],
    [input.minPlayers, "minPlayers", input.footballFormat],
    [input.maxPlayersPerTeam, "maxPlayersPerTeam", 1],
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
  if (input.maxTeams < input.minTeams || input.maxPlayersPerTeam < input.minPlayers) {
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
): Promise<Tournament> {
  const existing = await findTournamentById(id);
  if (!existing) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  if (
    existing.status !== "DRAFT" &&
    (input.maxTeams !== undefined || input.startDate !== undefined || input.endDate !== undefined)
  ) {
    throw new AppError(
      409,
      "Dates and team limits are locked after the tournament leaves draft; review registrations, draw and schedule impact first",
      "TOURNAMENT_STRUCTURE_LOCKED",
    );
  }

  if (input.status !== undefined && input.status !== existing.status) {
    await assertTournamentStatusTransition(existing, input.status);
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

  // Business rule: cannot delete tournament in progress
  if (existing.status === "IN_PROGRESS" && input.status === "CANCELLED") {
    // Allow cancellation but may need to check with match-service in future
  }

  const updated = await updateTournament(id, input);
  if (!updated) {
    throw new AppError(404, "Tournament not found", "TOURNAMENT_NOT_FOUND");
  }
  return updated;
}

type RegistrationCandidate = {
  teamId: string;
  isActive: boolean;
  registrationStatus: string;
  institutionId: string | null;
  verifiedRosterCount: number;
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

async function assertRosterCanBeLocked(tournament: Tournament): Promise<void> {
  const result = await getServiceJson<{ candidates: RegistrationCandidate[] }>(
    config.organizationServiceUrl,
    `/internal/tournaments/${encodeURIComponent(tournament.id)}/draw-candidates`,
    "Organization service",
  );
  if (!Array.isArray(result.candidates)) {
    throw new AppError(502, "Organization service returned an invalid registration list", "UPSTREAM_ERROR");
  }
  const pendingCount = result.candidates.filter((item) => item.registrationStatus === "PENDING").length;
  if (pendingCount) {
    throw new AppError(409, `Resolve all ${pendingCount} pending team registration(s) before locking the roster`, "REGISTRATIONS_PENDING");
  }
  const approved = result.candidates.filter((item) => item.registrationStatus === "APPROVED");
  if (approved.length < tournament.minTeams) {
    throw new AppError(409, `At least ${tournament.minTeams} approved teams are required before locking the roster`, "MINIMUM_TEAMS_NOT_MET");
  }
  const invalid = approved.filter((item) =>
    !item.isActive ||
    !item.institutionId ||
    item.verifiedRosterCount < tournament.minPlayers ||
    item.verifiedRosterCount > tournament.maxPlayersPerTeam,
  );
  if (invalid.length) {
    throw new AppError(409, `${invalid.length} approved team(s) still have an inactive team, invalid school, or roster outside the allowed player count`, "APPROVED_ROSTERS_NOT_READY");
  }
}

async function assertSchedulesReady(tournament: Tournament): Promise<void> {
  const [matches, scheduleResult] = await Promise.all([
    listTournamentMatches(tournament.id),
    getServiceJson<{ schedules: Array<{ matchId: string; refereeId: string | null }> }>(
      config.matchServiceUrl,
      `/tournaments/${encodeURIComponent(tournament.id)}/schedules`,
      "Match service",
    ),
  ]);
  const schedules = scheduleResult.schedules;
  if (!Array.isArray(matches) || !Array.isArray(schedules) || !matches.length) {
    throw new AppError(409, "Generate tournament fixtures before starting the competition", "FIXTURES_REQUIRED");
  }
  const scheduledMatchIds = new Set(schedules.map((schedule) => schedule.matchId));
  const missingSchedule = matches.filter((match) => !scheduledMatchIds.has(match.id));
  const missingReferee = schedules.filter((schedule) => !schedule.refereeId);
  if (missingSchedule.length || missingReferee.length || schedules.length !== matches.length) {
    throw new AppError(409, `${missingSchedule.length} match(es) still need a published schedule and ${missingReferee.length} published schedule(s) need a referee`, "SCHEDULES_NOT_READY");
  }
}

async function assertAllMatchesFinal(tournament: Tournament): Promise<void> {
  const matches = await listTournamentMatches(tournament.id);
  if (!matches.length) {
    throw new AppError(409, "The tournament has no matches to close", "MATCHES_REQUIRED");
  }
  const checks = await Promise.all(matches.map(async (match) => {
    const [result, report] = await Promise.all([
      getServiceJson<{ result: { status: string } | null }>(
        config.matchServiceUrl,
        `/matches/${encodeURIComponent(match.id)}/result`,
        "Match service",
      ),
      getServiceJson<{ report: { status: string } | null }>(
        config.matchServiceUrl,
        `/matches/${encodeURIComponent(match.id)}/report`,
        "Match service",
      ),
    ]);
    return [match.status, result.result?.status, report.report?.status] as const;
  }));
  const unresolved = checks.filter(([status, resultStatus, reportStatus]) =>
    !["VERIFIED", "LOCKED"].includes(status) || resultStatus !== "APPROVED" || reportStatus !== "APPROVED",
  ).length;
  if (unresolved) {
    throw new AppError(409, `${unresolved} match(es) still need a finalized status and an approved result and referee report`, "MATCHES_NOT_FINAL");
  }
}

async function assertTournamentStatusTransition(
  tournament: Tournament,
  next: TournamentStatus,
): Promise<void> {
  const transitions: Partial<Record<TournamentStatus, TournamentStatus[]>> = {
    DRAFT: ["OPEN_REGISTRATION", "CANCELLED"],
    OPEN_REGISTRATION: ["REGISTRATION_CLOSED", "CANCELLED"],
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
    await assertRosterCanBeLocked(tournament);
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
}

export async function assertWorkflowStepAvailable(tournamentId: string, step: number): Promise<void> {
  const tournament = await getTournament(tournamentId);
  const highestStepByStatus: Record<TournamentStatus, number> = {
    DRAFT: 1,
    OPEN_REGISTRATION: 2,
    REGISTRATION_CLOSED: 3,
    ROSTER_LOCKED: 4,
    PREPARING: 6,
    IN_PROGRESS: 8,
    PAUSED: 8,
    COMPLETED: 8,
    CANCELLED: 1,
  };
  if (step > highestStepByStatus[tournament.status]) {
    throw new AppError(409, `Complete the required tournament stage before opening workflow step ${step}`, "WORKFLOW_STEP_LOCKED");
  }
  if (step >= 7 && !["IN_PROGRESS", "PAUSED", "COMPLETED"].includes(tournament.status)) {
    throw new AppError(409, "Start the tournament before opening match operations", "MATCH_OPERATIONS_NOT_READY");
  }
  if (step === 8) {
    await assertAllMatchesFinal(tournament);
  }
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

  return createRegistrationPeriod(input);
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

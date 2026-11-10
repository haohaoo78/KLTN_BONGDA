import type { UserRole } from "@sfl/shared";
import { apiFetch } from "./client";
import type { Institution } from "./institutions";

export type Tournament = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  location: string | null;
  maxTeams: number;
  startDate: string | null;
  endDate: string | null;
  organizingInstitutionId?: string | null;
  organizerName?: string | null;
  organizerContactName?: string | null;
  organizerEmail?: string | null;
  organizerPhone?: string | null;
  scope?: "SINGLE_INSTITUTION" | "INTER_SCHOOL";
  footballFormat?: 7 | 11;
  competitionFormat?: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  minTeams?: number;
  minPlayers?: number;
  maxPlayersPerTeam?: number;
  registrationPeriods?: RegistrationPeriod[];
  allowedInstitutionIds?: string[];
  allowedInstitutionLevels?: Array<"UNIVERSITY" | "COLLEGE">;
  allInstitutionsAllowed?: boolean;
  defaultMaxTeamsPerInstitution?: number | null;
  institutionTeamLimits?: Array<{ institutionId: string; maxTeams: number | null }>;
  rankingCriteria?: string[];
  rules?: TournamentRules | null;
};

export type TournamentWorkflowState = {
  tournamentId: string;
  currentStep: number;
  updatedBy: string;
  updatedAt: string;
};

export function getTournamentWorkflowState(tournamentId: string): Promise<{ workflow: TournamentWorkflowState }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/workflow-state`);
}

export function updateTournamentWorkflowStep(tournamentId: string, currentStep: number): Promise<{ workflow: TournamentWorkflowState }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/workflow-state`, {
    method: "PUT",
    body: JSON.stringify({ currentStep }),
  });
}

export type DrawCandidate = {
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
  eligible: boolean;
  ineligibilityReason: string | null;
};

export type DrawAssignment = {
  teamId: string;
  groupId: string;
  groupName: string;
  position: number;
  seedGroup: number | null;
};

export type DrawGroup = {
  id: string;
  name: string;
  maxTeams: number;
  assignments: DrawAssignment[];
};

export type DrawVersion = {
  id: string;
  tournamentId: string;
  version: number;
  status: "DRAFT" | "CONFIRMED" | "PUBLISHED" | "ARCHIVED";
  method: "RANDOM" | "SEEDED" | "MANUAL";
  config: Record<string, unknown>;
  changeReason: string | null;
  createdBy: string;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  groups: DrawGroup[];
};

export type DrawPlanInput = {
  method: "RANDOM" | "SEEDED" | "MANUAL";
  groupCount: number;
  maxTeamsPerGroup?: number;
  noSameInstitution?: boolean;
  groups?: Array<{ name: string; teamIds: string[] }>;
  seedings?: Array<{ teamId: string; seedGroup: number }>;
  changeReason?: string;
};

export type DrawPreview = {
  eligibleTeams: DrawCandidate[];
  ineligibleTeams: DrawCandidate[];
  groups: DrawGroup[];
  unassignedTeamIds: string[];
};

export type TournamentRules = {
  eligibilityDescription: string;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  advancingTeamsPerGroup: number;
  yellowCardsForSuspension: number;
  suspensionMatches: number;
  complaintWindowHours: number;
  minimumRestMinutes: number;
  matchDurationMinutes: number;
  forfeitPolicy: string;
  forfeitWinnerScore: number;
  forfeitLoserScore: number;
  publishedVersion: number;
  publishedAt: string | null;
};

export type RegistrationPeriod = {
  id: string;
  tournamentId: string;
  name: string;
  startDate: string;
  endDate: string;
  createdAt: string;
};

export type TournamentRegulation = {
  id: string;
  tournamentId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type RegulationVersion = {
  id: string;
  tournamentId: string;
  version: number;
  title: string;
  content: string;
  effectiveDate: string;
  createdBy: string;
  createdAt: string;
};

export type TournamentCreateInput = {
  name: string;
  description?: string;
  location: string;
  organizerName: string;
  organizerContactName: string;
  organizerEmail: string;
  organizerPhone: string;
  scope: "SINGLE_INSTITUTION" | "INTER_SCHOOL";
  allowedInstitutionIds: string[];
  allowedInstitutionLevels: Array<"UNIVERSITY" | "COLLEGE">;
  allInstitutionsAllowed: boolean;
  defaultMaxTeamsPerInstitution: number | null;
  institutionTeamLimits: Array<{ institutionId: string; maxTeams: number | null }>;
  footballFormat: 7 | 11;
  competitionFormat: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  minTeams: number;
  maxTeams: number;
  minPlayers: number;
  maxPlayersPerTeam: number;
  startDate: string;
  endDate: string;
  registrationStart: string;
  registrationEnd: string;
  eligibilityDescription: string;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  rankingCriteria: Array<
    "POINTS" | "GOAL_DIFFERENCE" | "GOALS_FOR" | "HEAD_TO_HEAD" | "FAIR_PLAY" | "LOT_DRAW"
  >;
  advancingTeamsPerGroup: number;
  yellowCardsForSuspension: number;
  suspensionMatches: number;
  complaintWindowHours: number;
  minimumRestMinutes: number;
  matchDurationMinutes: number;
  forfeitPolicy: "ORGANIZER_DECISION" | "WALKOVER" | "NO_AUTOMATIC_RESULT";
  forfeitWinnerScore: number;
  forfeitLoserScore: number;
};

export type Match = {
  id: string;
  tournamentId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string | null;
  venue: string | null;
  round: string | null;
  status: string;
};

export type MatchResult = {
  id: string;
  matchId: string;
  homeScore: number;
  awayScore: number;
  homeExtraTimeScore: number | null;
  awayExtraTimeScore: number | null;
  homePenaltyScore: number | null;
  awayPenaltyScore: number | null;
  recordedBy: string;
  recordedAt: string;
  notes: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
};

export type MatchReport = {
  id: string;
  matchId: string;
  refereeId: string;
  homeCaptainId: string | null;
  awayCaptainId: string | null;
  homeScoreAtHalfTime: number | null;
  awayScoreAtHalfTime: number | null;
  attendance: number | null;
  weather: string | null;
  notes: string | null;
  submittedBy: string;
  submittedAt: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "REVISION_REQUIRED";
  reviewNote: string | null;
};

export function getMatchById(matchId: string): Promise<{ match: Match }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}`);
}

export function getMatchResult(matchId: string): Promise<{ result: MatchResult | null }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/result`);
}

export function getManagedMatchResult(matchId: string): Promise<{ result: MatchResult | null }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/result/manage`);
}

export function getMatchReport(matchId: string): Promise<{ report: MatchReport | null }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/report`);
}

export function getManagedMatchReport(matchId: string): Promise<{ report: MatchReport | null }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/report/manage`);
}

export function recordMatchResult(input: {
  matchId: string;
  homeScore: number;
  awayScore: number;
  notes?: string;
}): Promise<{ result: MatchResult }> {
  return apiFetch("/match-results", { method: "POST", body: JSON.stringify(input) });
}

export function submitMatchReport(input: {
  matchId: string;
  homeScoreAtHalfTime: number;
  awayScoreAtHalfTime: number;
  attendance?: number;
  weather?: string;
  notes?: string;
}): Promise<{ report: MatchReport }> {
  return apiFetch("/match-reports", { method: "POST", body: JSON.stringify(input) });
}

export function reviewMatchReport(
  reportId: string,
  status: "APPROVED" | "REJECTED" | "REVISION_REQUIRED",
  reviewNote?: string,
): Promise<{ report: MatchReport }> {
  return apiFetch(`/match-reports/${encodeURIComponent(reportId)}/review`, {
    method: "PUT",
    body: JSON.stringify({ status, reviewNote }),
  });
}

export function updateRefereeMatchStatus(
  matchId: string,
  status: "LINEUP_CONFIRMED" | "IN_PROGRESS" | "FINISHED",
): Promise<{ match: Match }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/referee-status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export type Standing = {
  id: string;
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
};

export type Team = {
  id: string;
  name: string;
  shortName: string | null;
  description: string | null;
  logoUrl: string | null;
  institutionId: string | null;
  institutionName?: string | null;
  unitName: string | null;
  representativeName: string | null;
  kitColor: string | null;
  captainId: string;
  isPlayer?: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  maxPlayers: number;
  isActive: boolean;
};

export type PublicTeam = Pick<
  Team,
  | "id"
  | "name"
  | "shortName"
  | "description"
  | "logoUrl"
  | "institutionId"
  | "unitName"
  | "kitColor"
  | "isActive"
>;

export type PublicTeamPlayer = {
  id: string;
  fullName: string | null;
  jerseyNumber: number | null;
  position: string | null;
  teamRole: "CAPTAIN" | "PLAYER";
};

export type PublicTeamDetail = {
  team: Omit<PublicTeam, "isActive"> & {
    institutionName: string | null;
    representativeName: string | null;
    tournamentIds: string[];
  };
  players: PublicTeamPlayer[];
};

export type Player = {
  id: string;
  teamId: string;
  userId: string | null;
  fullName: string | null;
  birthDate: string | null;
  studentId: string | null;
  contactEmail: string | null;
  evidenceUrl: string | null;
  jerseyNumber: number | null;
  position: string | null;
  isCaptain: boolean;
  joinedAt?: string;
  leftAt?: string | null;
};

export type PlayerTeamRequest = {
  id: string;
  teamId: string;
  userId: string;
  fullName: string | null;
  birthDate: string | null;
  studentId: string | null;
  contactEmail: string | null;
  profileData?: Record<string, string | null>;
  message: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  createdAt: string;
  respondedAt: string | null;
  reviewedBy: string | null;
  decisionReason: string | null;
};

export type PlayerLeaveRequest = {
  id: string;
  teamId: string;
  teamName: string;
  playerId: string;
  userId: string;
  playerName: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  requestedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  decisionReason: string | null;
  overdue: boolean;
};

export type ClubRequest = {
  id: string;
  applicantId: string;
  institutionId: string;
  captainName: string;
  name: string;
  shortName: string | null;
  description: string | null;
  logoUrl: string | null;
  unitName: string | null;
  contactEmail: string;
  contactPhone: string;
  initialMembers: Array<Record<string, unknown>>;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decisionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  approvedTeamId: string | null;
  createdAt: string;
};

export function getMyClubRequests(): Promise<{ requests: ClubRequest[] }> {
  return apiFetch("/club-requests/my");
}

export function getClubRequests(
  statusOrFilters: string | {
    status?: ClubRequest["status"];
    search?: string;
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
    offset?: number;
  } = "PENDING",
): Promise<{
  requests: ClubRequest[];
  pagination: { limit: number; offset: number; total: number };
}> {
  const filters: {
    status?: ClubRequest["status"];
    search?: string;
    createdFrom?: string;
    createdTo?: string;
    limit?: number;
    offset?: number;
  } = typeof statusOrFilters === "string"
    ? { status: statusOrFilters as ClubRequest["status"] }
    : statusOrFilters;
  const query = new URLSearchParams({
    limit: String(filters.limit ?? 20),
    offset: String(filters.offset ?? 0),
  });
  query.set("status", filters.status ?? "ALL");
  if (filters.search) query.set("search", filters.search);
  if (filters.createdFrom) query.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) query.set("createdTo", filters.createdTo);
  return apiFetch(`/club-requests?${query.toString()}`);
}

export function submitClubRequest(input: {
  name: string;
  shortName?: string;
  description?: string;
  logoUrl?: string;
  unitName?: string;
  contactEmail: string;
  contactPhone: string;
  initialMembers: Array<Record<string, unknown>>;
}): Promise<{ request: ClubRequest }> {
  return apiFetch("/club-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function reviewClubRequest(input: {
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  decisionNote?: string;
}): Promise<{ request: ClubRequest }> {
  return apiFetch(`/club-requests/${encodeURIComponent(input.requestId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export type TeamRegistration = {
  id: string;
  teamId: string;
  tournamentId: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  registeredAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  notes: string | null;
  institutionId: string | null;
  institutionName?: string | null;
};

export type TournamentRegistrationOption = {
  tournament: Tournament;
  eligible: boolean;
  ineligibilityReason: string | null;
  registeredTeamsForInstitution: number;
  maxTeamsPerInstitution: number | null;
};

export type RosterEntry = {
  id: string;
  teamId: string;
  tournamentId: string;
  playerId: string;
  lineupRole: "STARTER" | "SUBSTITUTE";
  isGoalkeeper: boolean;
  evidenceUrl: string | null;
  isVerified: boolean;
  verifiedAt: string | null;
  reviewStatus: "PENDING" | "APPROVED" | "REVISION_REQUIRED" | "REJECTED";
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
};

export function getTournaments(filters: {
  statuses?: string[];
  search?: string;
  scope?: Tournament["scope"];
  institutionId?: string;
  fromDate?: string;
  toDate?: string;
  sortBy?: "CREATED_AT" | "NAME" | "START_DATE";
  sortOrder?: "ASC" | "DESC";
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: Tournament[]; total: number }> {
  const query = new URLSearchParams({
    limit: String(filters.limit ?? 100),
    offset: String(filters.offset ?? 0),
  });
  if (filters.statuses?.length) query.set("statuses", filters.statuses.join(","));
  if (filters.search?.trim()) query.set("search", filters.search.trim());
  if (filters.scope) query.set("scope", filters.scope);
  if (filters.institutionId) query.set("institutionId", filters.institutionId);
  if (filters.fromDate) query.set("fromDate", filters.fromDate);
  if (filters.toDate) query.set("toDate", filters.toDate);
  if (filters.sortBy) query.set("sortBy", filters.sortBy);
  if (filters.sortOrder) query.set("sortOrder", filters.sortOrder);
  return apiFetch(`/tournaments?${query.toString()}`);
}

export function getTournamentRegistrationOptions(institutionId: string): Promise<{
  options: TournamentRegistrationOption[];
}> {
  const query = new URLSearchParams({ institutionId });
  return apiFetch(`/tournaments/registration-options?${query.toString()}`);
}

export function getTournament(tournamentId: string): Promise<{ tournament: Tournament }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}`);
}

export function getDrawManagement(tournamentId: string): Promise<{
  eligibleTeams: DrawCandidate[];
  ineligibleTeams: DrawCandidate[];
  latestVersion: DrawVersion | null;
  history: DrawVersion[];
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management`);
}

export function previewTournamentDraw(
  tournamentId: string,
  input: DrawPlanInput,
): Promise<DrawPreview> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/preview`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveTournamentDrawDraft(
  tournamentId: string,
  input: DrawPlanInput,
): Promise<{ draw: DrawVersion }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/drafts`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function confirmTournamentDraw(tournamentId: string): Promise<{ draw: DrawVersion }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/confirm`, {
    method: "POST",
  });
}

export function publishTournamentDraw(tournamentId: string): Promise<{ draw: DrawVersion }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/publish`, {
    method: "POST",
  });
}

export function generateTournamentFixtures(
  tournamentId: string,
  legs: 1 | 2,
): Promise<{
  drawVersionId: string;
  legs: 1 | 2;
  matches: Match[];
  alreadyGenerated: boolean;
  knockoutStagePending: boolean;
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/generate`, {
    method: "POST",
    body: JSON.stringify({ legs }),
  });
}

export function getPublishedTournamentDraw(tournamentId: string): Promise<{ draw: DrawVersion | null }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-public`);
}

export function getTournamentRegulations(tournamentId: string): Promise<{
  regulations: TournamentRegulation[];
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/regulations`);
}

export function updateTournament(
  tournamentId: string,
  input: { name?: string; description?: string; location?: string; status?: string; maxTeams?: number; startDate?: string; endDate?: string },
): Promise<{ tournament: Tournament }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function createTournamentRegulation(
  tournamentId: string,
  input: { title: string; content: string },
): Promise<{ regulation: TournamentRegulation }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/regulations`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTournamentRegulation(
  regulationId: string,
  input: { title: string; content: string },
): Promise<{ regulation: TournamentRegulation }> {
  return apiFetch(`/regulations/${encodeURIComponent(regulationId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteTournamentRegulation(regulationId: string): Promise<void> {
  await apiFetch(`/regulations/${encodeURIComponent(regulationId)}`, { method: "DELETE" });
}

export function getTournamentRegulationVersions(tournamentId: string): Promise<{
  versions: RegulationVersion[];
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/regulation-versions`);
}

export function getMatches(
  tournamentId: string,
): Promise<{ items: Match[]; total: number }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/matches?limit=100&offset=0`);
}

export function getStandings(
  tournamentId: string,
): Promise<{ standings: Standing[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/standings`);
}

export function getTeams(): Promise<{ items: Team[]; total: number }> {
  return apiFetch("/teams?limit=100&offset=0");
}

export function getPublicTeams(filters: { institutionId?: string; search?: string; isActive?: boolean; sortBy?: "NAME" | "CREATED_AT"; limit?: number; offset?: number } = {}): Promise<{ items: PublicTeam[]; total: number }> {
  const params = new URLSearchParams({
    limit: String(filters.limit ?? 20),
    offset: String(filters.offset ?? 0),
  });
  if (filters.institutionId) params.set("institutionId", filters.institutionId);
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.isActive !== undefined) params.set("isActive", String(filters.isActive));
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  return apiFetch(`/public/teams?${params.toString()}`);
}

export function getPublicTeamDetail(teamId: string): Promise<PublicTeamDetail> {
  return apiFetch(`/public/teams/${encodeURIComponent(teamId)}`);
}

export type PublicTournamentTeam = {
  id: string;
  name: string;
  shortName: string | null;
  logoUrl: string | null;
  institutionId: string | null;
  institutionName: string | null;
  unitName: string | null;
};

export function getPublishedTournamentTeams(tournamentId: string): Promise<{ teams: PublicTournamentTeam[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/approved-teams`);
}

export async function getTeamsForMyTournaments(): Promise<{
  items: Team[];
  total: number;
}> {
  const { items: tournaments } = await getMyTournaments();
  const registrationLists = await Promise.all(
    tournaments.map(async (tournament) => {
      const { registrations } = await getTournamentRegistrations(tournament.id);
      return registrations;
    }),
  );
  const teamIds = [...new Set(registrationLists.flat().map((registration) => registration.teamId))];
  const items = await Promise.all(
    teamIds.map(async (teamId) => (await getTeam(teamId)).team),
  );
  return { items, total: items.length };
}

export function getMyTeams(): Promise<{ teams: Team[] }> {
  return apiFetch("/teams/my");
}

export function getMyManagedTeams(): Promise<{ teams: Team[] }> {
  return apiFetch("/teams/my/managed");
}

export function linkTeamToVerifiedSchool(teamId: string): Promise<{ team: Team }> {
  return apiFetch(`/teams/${encodeURIComponent(teamId)}/link-verified-school`, { method: "POST" });
}

export function getMyPlayerTeamRequests(): Promise<{ requests: PlayerTeamRequest[] }> {
  return apiFetch("/player-requests/my");
}

export function getTeamPlayerRequests(teamId: string): Promise<{ requests: PlayerTeamRequest[] }> {
  return apiFetch(`/teams/${encodeURIComponent(teamId)}/player-requests`);
}

export function submitPlayerTeamRequest(input: {
  teamId: string;
  fullName: string;
  birthDate?: string;
  studentId?: string;
  profileData?: Record<string, string | null>;
  message?: string;
}): Promise<{ request: PlayerTeamRequest }> {
  return apiFetch("/player-requests", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function respondPlayerTeamRequest(
  requestId: string,
  status: "APPROVED" | "REJECTED",
  decisionReason?: string,
): Promise<{ request: PlayerTeamRequest }> {
  return apiFetch(`/player-requests/${encodeURIComponent(requestId)}`, {
    method: "PUT",
    body: JSON.stringify({ status, decisionReason }),
  });
}

export function withdrawPlayerTeamRequest(requestId: string): Promise<{ request: PlayerTeamRequest }> {
  return apiFetch(`/player-requests/${encodeURIComponent(requestId)}/withdraw`, { method: "POST" });
}

export function getMyPlayerLeaveRequests(): Promise<{ requests: PlayerLeaveRequest[] }> {
  return apiFetch("/player-leave-requests/my");
}

export function getTeamPlayerLeaveRequests(teamId: string, overdue = false): Promise<{ requests: PlayerLeaveRequest[] }> {
  const query = overdue ? "?overdue=true" : "";
  return apiFetch(`/teams/${encodeURIComponent(teamId)}/player-leave-requests${query}`);
}

export function submitPlayerLeaveRequest(reason: string): Promise<{ request: PlayerLeaveRequest }> {
  return apiFetch("/player-leave-requests", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function withdrawPlayerLeaveRequest(requestId: string): Promise<{ request: PlayerLeaveRequest }> {
  return apiFetch(`/player-leave-requests/${encodeURIComponent(requestId)}/withdraw`, { method: "POST" });
}

export function respondPlayerLeaveRequest(input: {
  requestId: string;
  decision: "APPROVED" | "REJECTED";
  decisionReason?: string;
}): Promise<{ request: PlayerLeaveRequest }> {
  return apiFetch(`/player-leave-requests/${encodeURIComponent(input.requestId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function getTeam(teamId: string): Promise<{ team: Team }> {
  return apiFetch(`/teams/${encodeURIComponent(teamId)}`);
}

export function getTournamentRegistrations(tournamentId: string, filters: {
  status?: TeamRegistration["status"];
  institutionId?: string;
  search?: string;
} = {}): Promise<{
  registrations: TeamRegistration[];
  schoolCounts: Array<{
    institutionId: string;
    institutionName: string;
    pending: number;
    approved: number;
    total: number;
  }>;
}> {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.institutionId) query.set("institutionId", filters.institutionId);
  if (filters.search) query.set("search", filters.search);
  return apiFetch(
    `/tournaments/${encodeURIComponent(tournamentId)}/registrations${query.size ? `?${query}` : ""}`,
  );
}

export function getMyTeamRegistration(teamId: string, tournamentId: string): Promise<{
  registration: TeamRegistration;
}> {
  return apiFetch(
    `/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/registration`,
  );
}

export function getMyTeamRegistrations(teamId: string): Promise<{ registrations: TeamRegistration[] }> {
  return apiFetch(`/teams/${encodeURIComponent(teamId)}/registrations`);
}

export function getMyTeamTournamentRegistrations(): Promise<{ registrations: TeamRegistration[] }> {
  return apiFetch("/teams/my/registrations");
}

export function createTeamRegistration(input: {
  teamId: string;
  tournamentId: string;
  notes?: string;
  roster?: Array<{
    playerId: string;
    lineupRole: "STARTER" | "SUBSTITUTE";
    isGoalkeeper: boolean;
    evidenceUrl?: string;
  }>;
}): Promise<{ registration: TeamRegistration }> {
  return apiFetch("/registrations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getTournamentRosters(tournamentId: string, teamId?: string): Promise<{
  rosters: RosterEntry[];
}> {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/rosters${query}`);
}

export function createTournamentRoster(input: {
  tournamentId: string;
  teamId: string;
  playerId: string;
  evidenceUrl?: string;
}): Promise<{ roster: RosterEntry }> {
  return apiFetch("/rosters", { method: "POST", body: JSON.stringify(input) });
}

export function reviewTournamentRoster(
  tournamentId: string,
  rosterId: string,
  status: "APPROVED" | "REVISION_REQUIRED" | "REJECTED",
  note?: string,
): Promise<{ roster: RosterEntry }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/rosters/${encodeURIComponent(rosterId)}/review`, {
    method: "PATCH",
    body: JSON.stringify({ status, note }),
  });
}

export function updateTournamentRosterEvidence(
  tournamentId: string,
  rosterId: string,
  evidenceUrl: string,
): Promise<{ roster: RosterEntry }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/rosters/${encodeURIComponent(rosterId)}`, {
    method: "PUT",
    body: JSON.stringify({ evidenceUrl }),
  });
}

export function deleteTournamentRoster(tournamentId: string, rosterId: string): Promise<void> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/rosters/${encodeURIComponent(rosterId)}`, { method: "DELETE" });
}

export function updateTeamRegistration(
  registrationId: string,
  status: "APPROVED" | "REJECTED",
  notes?: string,
): Promise<{ registration: TeamRegistration }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}`, {
    method: "PUT",
    body: JSON.stringify({ status, notes }),
  });
}

export function getMyTournaments(): Promise<{
  items: Array<{ id: string; name: string; status: string }>;
  total: number;
}> {
  return apiFetch("/my/tournaments");
}

export type TournamentOrganizer = {
  userId: string;
  email: string;
  fullName: string;
  institutionId: string;
};

export function getTournamentOrganizers(tournamentId: string): Promise<{ userIds: string[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/organizers`);
}

export function getTournamentOrganizerCandidates(
  tournamentId: string,
  search = "",
): Promise<{ candidates: TournamentOrganizer[] }> {
  const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/organizer-candidates${query}`);
}

export async function assignTournamentOrganizer(
  tournamentId: string,
  userId: string,
): Promise<void> {
  await apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/organizers/${encodeURIComponent(userId)}`, {
    method: "PUT",
  });
}

export async function removeTournamentOrganizer(
  tournamentId: string,
  userId: string,
): Promise<void> {
  await apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/organizers/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

export type RefereeSchedule = {
  id: string;
  tournamentId: string;
  matchId: string;
  venueId: string;
  refereeId: string | null;
  scheduledDate: string;
  durationMinutes: number;
  status: string;
};

export type Venue = {
  id: string;
  name: string;
  location: string;
  capacity: number | null;
  surface: string | null;
  isActive: boolean;
};

export type TournamentSchedule = {
  id: string;
  tournamentId: string;
  matchId: string;
  venueId: string;
  refereeId: string | null;
  scheduledDate: string;
  durationMinutes: number;
  status: "DRAFT" | "PUBLISHED" | "CANCELLED" | "RESCHEDULED";
};

export type MatchPauseRequest = {
  id: string;
  matchId: string;
  requestedBy: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export function getMatchPauseRequests(matchId: string): Promise<{ requests: MatchPauseRequest[] }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/pause-requests`);
}

export function createMatchPauseRequest(
  matchId: string,
  reason: string,
): Promise<{ request: MatchPauseRequest }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/pause-requests`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function reviewMatchPauseRequest(
  requestId: string,
  decision: "APPROVED" | "REJECTED",
  reviewNote?: string,
): Promise<{ request: MatchPauseRequest }> {
  return apiFetch(`/pause-requests/${encodeURIComponent(requestId)}/review`, {
    method: "PUT",
    body: JSON.stringify({ decision, reviewNote }),
  });
}

export function getActiveVenues(): Promise<{ venues: Venue[] }> {
  return apiFetch("/venues?isActive=true");
}

export function getManagedTournamentSchedules(
  tournamentId: string,
): Promise<{ schedules: TournamentSchedule[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules/manage`);
}

export function createTournamentSchedule(input: {
  tournamentId: string;
  matchId: string;
  venueId: string;
  refereeId?: string;
  scheduledDate: string;
  durationMinutes?: number;
}): Promise<{ schedule: TournamentSchedule }> {
  return apiFetch("/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateTournamentSchedule(
  id: string,
  changes: { status?: TournamentSchedule["status"]; refereeId?: string | null },
): Promise<{ schedule: TournamentSchedule }> {
  return apiFetch(`/schedules/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(changes),
  });
}

export function getMySchedules(): Promise<{ schedules: RefereeSchedule[] }> {
  return apiFetch("/my/schedules");
}

export function getPlayers(teamId: string, includeLeft = false): Promise<{ players: Player[] }> {
  const query = includeLeft ? "?includeLeft=true" : "";
  return apiFetch(`/teams/${encodeURIComponent(teamId)}/players${query}`);
}

export function addPlayer(input: {
  teamId: string;
  fullName: string;
  birthDate?: string;
  studentId?: string;
  contactEmail?: string;
  evidenceUrl?: string;
  jerseyNumber?: number;
  position?: string;
}): Promise<{ player: Player }> {
  return apiFetch("/players", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updatePlayer(id: string, input: {
  fullName?: string;
  birthDate?: string;
  studentId?: string;
  contactEmail?: string;
  evidenceUrl?: string;
  jerseyNumber?: number;
  position?: string;
  isCaptain?: boolean;
}): Promise<{ player: Player }> {
  return apiFetch(`/players/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deletePlayer(id: string): Promise<void> {
  return apiFetch(`/players/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function createTournament(input: TournamentCreateInput): Promise<{ tournament: Tournament }> {
  return apiFetch("/tournaments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createTeam(input: {
  name: string;
  shortName?: string;
  description?: string;
  logoUrl?: string;
  institutionId: string;
  unitName?: string;
  representativeName?: string;
  kitColor?: string;
  contactEmail?: string;
  contactPhone?: string;
  maxPlayers: number;
}): Promise<{ team: Team }> {
  return apiFetch("/teams", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function canManageTournaments(roles: UserRole[]): boolean {
  return roles.includes("BTC");
}

export function institutionForTeam(
  team: Team,
  institutions: Institution[],
): Institution | undefined {
  return institutions.find((institution) => institution.id === team.institutionId);
}

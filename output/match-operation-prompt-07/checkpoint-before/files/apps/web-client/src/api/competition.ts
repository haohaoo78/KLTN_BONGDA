import type {MatchClockPhase,MatchClockAction,MatchClockState,MatchClockActionOptions} from "@sfl/shared";
export type {MatchClockPhase,MatchClockAction} from "@sfl/shared";
import type { AutoScheduleConfiguration, AutomaticSchedulePlan, UserRole } from "@sfl/shared";
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
  footballFormat?: 5 | 7 | 11;
  competitionFormat?: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  roundRobinLegs?: 1 | 2;
  maxTeamsPerGroup?: number | null;
  minTeams?: number;
  minPlayers?: number;
  maxPlayersPerTeam?: number;
  minGoalkeepers?: number;
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
  method: "RANDOM" | "MANUAL";
  groupCount: number;
  teamsPerGroup: number[];
  maxTeamsPerGroup?: number;
  noSameInstitution?: boolean;
  groups?: Array<{ name: string; teamIds: string[]; positions?: number[] }>;
  seededTeamIds?: string[];
  changeReason?: string;
};

export type DrawTestConfiguration = {
  format: "ROUND_ROBIN" | "KNOCKOUT" | "GROUP_AND_KNOCKOUT";
  teamIds: string[];
  groupCount: number;
  teamsPerGroup: number[];
  roundRobinLegs: 1 | 2;
  qualifiersPerGroup: number;
  extraQualificationSlots: number;
  knockoutPairing: "GROUP_RANK" | "REDRAW" | "FIXED_CROSSOVER";
  thirdPlaceMatch: boolean;
  seedGroups: Record<string, number>;
  separateSameInstitution: boolean;
  byePolicy: "AUTOMATIC" | "SEEDED_FIRST";
  method: "DIRECT" | "RANDOM" | "MANUAL";
};

export type DrawTestConfigurationResponse = {
  enabled: boolean;
  config: DrawTestConfiguration | null;
  defaults: DrawTestConfiguration | null;
};

export type DrawPreview = {
  eligibleTeams: DrawCandidate[];
  ineligibleTeams: DrawCandidate[];
  groups: DrawGroup[];
  unassignedTeamIds: string[];
};

export type LiveDrawSession = {
  sessionId: string;
  tournamentId: string;
  status: "SCHEDULED" | "POSTPONED" | "LIVE" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FINALIZED";
  method: "RANDOM" | "SEEDED";
  seededTeamIds?: string[];
  eventName: string;
  scheduledAt: string;
  timeZone: string;
  announcement: string;
  location: string;
  totalPicks: number;
  revealedCount: number;
  createdAt: string;
  completedAt: string | null;
  finalizedAt: string | null;
  groups: Array<{ name: string; maxTeams: number }>;
  picks: Array<{ sequence: number; groupIndex: number; groupName: string; teamId: string; position: number; seedGroup: number | null; drawnAt: string }>;
  history: Array<{ at: string; type: string; actorId: string; detail: string; sequence: number | null }>;
};

export type LiveDrawScheduleInput = { eventName: string; scheduledAt: string; timeZone: string; announcement: string; location?: string };

export type TournamentRules = {
  eligibilityDescription: string;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  advancingTeamsPerGroup: number;
  roundRobinLegs: 1 | 2;
  maxTeamsPerGroup: number | null;
  knockoutDecisionMethod: "EXTRA_TIME_THEN_PENALTIES" | "PENALTIES_ONLY";
  extraTimeMinutes: number;
  plannedPitchCount: number;
  playableHoursPerDay: number;
  yellowCardsForSuspension: number;
  suspensionMatches: number;
  complaintWindowHours: number;
  minimumRestMinutes: number;
  matchDurationMinutes: number;
  forfeitPolicy: string;
  forfeitWinnerScore: number;
  forfeitLoserScore: number;
  competitionConfig?: TournamentCompetitionConfig;
  publishedVersion: number;
  publishedAt: string | null;
};

export type TournamentCompetitionConfig = {
  groupCountMode: "AUTO_BY_CAPACITY" | "FIXED";
  groupCount: number | null;
  groupAllocation: "BALANCED" | "TOP_UP_FIRST";
  sameInstitutionPolicy: "NONE" | "PREFER_SEPARATE" | "REQUIRE_SEPARATE";
  knockoutPairing: "GROUP_RANK" | "REDRAW" | "FIXED_CROSSOVER";
  fixedPairingRule: string;
  knockoutLegs: 1 | 2;
  thirdPlaceMatch: boolean;
  byePolicy: "AUTOMATIC" | "SEEDED_FIRST";
  schedulingStartTime: string;
  schedulingEndTime: string;
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
  footballFormat: 5 | 7 | 11;
  competitionFormat: "ROUND_ROBIN" | "GROUP_AND_KNOCKOUT" | "KNOCKOUT";
  competitionConfig: TournamentCompetitionConfig;
  roundRobinLegs: 1 | 2;
  maxTeamsPerGroup: number | null;
  knockoutDecisionMethod: "EXTRA_TIME_THEN_PENALTIES" | "PENALTIES_ONLY";
  extraTimeMinutes: number;
  plannedPitchCount: number;
  playableHoursPerDay: number;
  minTeams: number;
  maxTeams: number;
  minPlayers: number;
  maxPlayersPerTeam: number;
  minGoalkeepers: number;
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
  homeTeamId: string | null;
  awayTeamId: string | null;
  matchDate: string | null;
  venue: string | null;
  round: string | null;
  status: string;
  stage?: "GROUP" | "KNOCKOUT";
  drawVersionId?: string | null;
  groupId?: string | null;
  roundNumber?: number | null;
  leg?: number | null;
  fixtureKey?: string | null;
};

export type LiveMatchSummary = Match & {
  homeScore: number;
  awayScore: number;
  clockPhase: MatchClockPhase | null;
  elapsedSeconds: number;
  clockStartedAt: string | null;
  isClockRunning: boolean;
};

export type PublicMatchLiveState = {
  match: Match;
  events: MatchEvent[];
  lineups: MatchLineup[];
  result: MatchResult | null;
  provisionalResult: { status: string } | null;
  clock: MatchClock | null;
};

export function getLiveMatches(): Promise<{ items: LiveMatchSummary[] }> {
  return apiFetch("/matches/live");
}

export function getPublicMatchLiveState(matchId: string): Promise<PublicMatchLiveState> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/live-state`);
}

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

export type MatchResultCorrectionRequest = {
  id: string; matchId: string; tournamentId: string; requestedBy: string;
  originalResult: { matchId: string; homeScore: number; awayScore: number; homeExtraTimeScore: number | null; awayExtraTimeScore: number | null; homePenaltyScore: number | null; awayPenaltyScore: number | null; notes: string | null };
  proposedResult: { homeScore: number; awayScore: number; homeExtraTimeScore?: number; awayExtraTimeScore?: number; homePenaltyScore?: number; awayPenaltyScore?: number; notes?: string };
  reason: string; status: "PENDING" | "APPROVED" | "REJECTED"; reviewedBy: string | null;
    reviewedAt: string | null; reviewReason: string | null;
    cascadeSnapshot?: Array<{ matchId: string; previousHomeTeamId: string | null; previousAwayTeamId: string | null; nextHomeTeamId: string | null; nextAwayTeamId: string | null }>;
    createdAt: string;
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
  submissionSnapshots: Array<{
    submittedAt: string;
    result: { homeScore: number; awayScore: number; homeExtraTimeScore: number | null; awayExtraTimeScore: number | null; homePenaltyScore: number | null; awayPenaltyScore: number | null } | null;
    lineups: Array<{ teamId: string; playerId: string; position: string | null; jerseyNumber: number | null; isStarting: boolean; confirmedBy: string | null; confirmedAt: string | null }>;
    events: Array<{ teamId: string; playerId: string | null; eventType: MatchEvent["eventType"]; minute: number | null; description: string | null; createdBy: string; createdAt: string }>;
    clock: { phase: MatchClockPhase; elapsedSeconds: number; totalElapsedSeconds: number; updatedAt: string } | null;
  }>;
};

export type MatchEvent = { supersedesEventId?:string|null;operationId?:string|null;substitutionId?:string|null;relatedPlayerId?:string|null;opportunityId?:string|null;revision?:number;visibility?:"PUBLIC"|"CREW"; phase?:MatchClockPhase|null;periodElapsedSeconds?:number|null;addedTimeSeconds?:number|null;eventSequence?:string|null; id: string; matchId: string; teamId: string; playerId: string | null; eventType: "GOAL" | "YELLOW_CARD" | "RED_CARD" | "SUBSTITUTION_IN" | "SUBSTITUTION_OUT" | "OWN_GOAL" | "PENALTY_GOAL" | "SECOND_YELLOW_CARD" | "INJURY" | "PLAYER_LEAVE" | "REPLACEMENT_IN" | "PLAYER_RETURN" | "INCIDENT"; minute: number | null; description: string | null; createdAt: string };
export type MatchClock = MatchClockState;
export type MatchLineup = { id: string; matchId: string; teamId: string; playerId: string; position: string | null; jerseyNumber: number | null; isStarting: boolean };

export function getMatchLineups(matchId: string): Promise<{ lineups: MatchLineup[] }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/lineups`);
}

export function getMatchEvents(matchId: string): Promise<{ events: MatchEvent[] }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/events`);
}

export function createMatchEvent(input: { operationId?:string;relatedPlayerId?:string;opportunityId?:string;visibility?:"PUBLIC"|"CREW"; matchId: string; teamId: string; playerId?: string; eventType: MatchEvent["eventType"]; minute?: number; description?: string;phase?:MatchClockPhase;periodElapsedSeconds?:number;expectedClockVersion?:number }): Promise<{ event: MatchEvent }> {
  return apiFetch("/match-events", { method: "POST", body: JSON.stringify(input) });
}

export function voidMatchEvent(id: string, reason: string,expectedRevision?:number): Promise<void> {
  return apiFetch(`/match-events/${encodeURIComponent(id)}`, { method: "DELETE", body: JSON.stringify({ reason,expectedRevision }) });
}

export function getMatchById(matchId: string): Promise<{ match: Match }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}`);
}

export function getMatchClock(matchId: string): Promise<{ clock: MatchClock }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/clock`);
}

export function applyMatchClockAction(matchId: string, action: MatchClockAction, expectedVersion: number, options:MatchClockActionOptions={}): Promise<{ clock: MatchClock }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/clock-actions`, {
    method: "POST",
    body: JSON.stringify({ action, expectedVersion, ...options }),
  });
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
  homeExtraTimeScore?: number;
  awayExtraTimeScore?: number;
  homePenaltyScore?: number;
  awayPenaltyScore?: number;
  notes?: string;
}): Promise<{ result: MatchResult }> {
  return apiFetch("/match-results", { method: "POST", body: JSON.stringify(input) });
}

export function decideMatchForfeit(matchId: string, input: { forfeitingTeamId: string; reason: string }): Promise<{
  decision: { id: string; matchId: string; tournamentId: string; forfeitingTeamId: string; winnerTeamId: string; reason: string; policy: string; decidedBy: string; createdAt: string };
  result: MatchResult;
}> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/forfeit`, { method: "POST", body: JSON.stringify(input) });
}

export function getForfeitDecisions(tournamentId: string): Promise<{ decisions: Array<{
  id: string; matchId: string; forfeitingTeamId: string; winnerTeamId: string; reason: string;
  policy: string; homeScore: number; awayScore: number; decidedBy: string; createdAt: string;
}> }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/forfeit-decisions`);
}

export type ComplaintAppeal = {
  id: string; complaintId: string; submittedBy: string; description: string; evidence: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED"; submittedAt: string; reviewedBy: string | null;
  reviewedAt: string | null; decisionReason: string | null;
  originalDecision: { status: string; reviewedBy: string | null; reviewedAt: string | null; decision: string | null; decisionReason: string | null } | null;
};

export type TournamentComplaint = {
  id: string; matchId: string; tournamentId: string; teamId: string; submittedBy: string;
  complaintType: string; description: string; evidence: string | null;
  status: "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CLOSED";
  submittedAt: string; reviewedBy: string | null; reviewedAt: string | null;
  decision: string | null; decisionReason: string | null;
};

export function getTournamentComplaints(tournamentId: string, teamId?: string): Promise<{ complaints: TournamentComplaint[] }> {
  const query = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/complaints${query}`);
}

export function createTournamentComplaint(input: {
  matchId: string;
  tournamentId: string;
  teamId: string;
  complaintType: string;
  description: string;
  evidence?: string;
}): Promise<{ complaint: TournamentComplaint }> {
  return apiFetch("/complaints", { method: "POST", body: JSON.stringify(input) });
}

export function reviewTournamentComplaint(complaintId: string, input: {
  status: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "CLOSED"; decision?: string; decisionReason?: string;
}): Promise<{ complaint: TournamentComplaint }> {
  return apiFetch(`/complaints/${encodeURIComponent(complaintId)}/review`, {
    method: "PUT", body: JSON.stringify(input),
  });
}

export function getComplaintAppeals(tournamentId: string, status?: ComplaintAppeal["status"]): Promise<{ appeals: ComplaintAppeal[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/complaint-appeals${query}`);
}

export function getComplaintAppealStatus(complaintId: string): Promise<{ appeal: ComplaintAppeal | null }> {
  return apiFetch(`/complaints/${encodeURIComponent(complaintId)}/appeals`);
}

export function submitComplaintAppeal(complaintId: string, input: { description: string; evidence?: string }): Promise<{ appeal: ComplaintAppeal }> {
  return apiFetch(`/complaints/${encodeURIComponent(complaintId)}/appeals`, {
    method: "POST", body: JSON.stringify(input),
  });
}

export function reviewComplaintAppeal(appealId: string, status: "APPROVED" | "REJECTED", decisionReason: string): Promise<{ appeal: ComplaintAppeal; followUpRequired: boolean }> {
  return apiFetch(`/complaint-appeals/${encodeURIComponent(appealId)}/review`, {
    method: "PUT", body: JSON.stringify({ status, decisionReason }),
  });
}

export function createResultCorrectionRequest(matchId: string, input: {
  homeScore: number; awayScore: number; homeExtraTimeScore?: number; awayExtraTimeScore?: number;
  homePenaltyScore?: number; awayPenaltyScore?: number; notes?: string; reason: string;
}): Promise<{ request: MatchResultCorrectionRequest }> {
  return apiFetch(`/matches/${encodeURIComponent(matchId)}/result-correction-requests`, { method: "POST", body: JSON.stringify(input) });
}

export function getResultCorrectionRequests(tournamentId: string, status?: MatchResultCorrectionRequest["status"]): Promise<{ requests: MatchResultCorrectionRequest[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/result-correction-requests${query}`);
}

export function reviewResultCorrectionRequest(id: string, decision: "APPROVED" | "REJECTED", reviewReason: string): Promise<{ request: MatchResultCorrectionRequest }> {
  return apiFetch(`/result-correction-requests/${encodeURIComponent(id)}/review`, { method: "PUT", body: JSON.stringify({ decision, reviewReason }) });
}

export function submitMatchReport(input: {
  matchId: string;
  homeScoreAtHalfTime: number;
  awayScoreAtHalfTime: number;
  attendance?: number;
  weather?: string;
  notes?: string;
  requiresOrganizerReview?: boolean;
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
  teamName?: string | null;
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
  status: "PENDING" | "APPROVED" | "REJECTED" | "APPROVAL_REVOKED" | "REVISION_REQUIRED" | "NEEDS_SUPPLEMENT" | "WITHDRAWN" | "WAITLIST" | "CONFLICT_ADJUSTMENT_REQUIRED";
  version?: number;
  resubmissionAllowed?: boolean;
  registeredAt: string;
  submittedAt: string;
  submissionSequence: number;
  supplementDeadline: string | null;
  supplementCompletedAt: string | null;
  isNextInQueue?: boolean;
  rosterCount?: number;
  confirmedRosterCount?: number;
  approvedAt: string | null;
  approvedBy: string | null;
  notes: string | null;
  institutionId: string | null;
  institutionName?: string | null;
  registrationConflicts?: Array<{ playerId: string; playerName?: string; conflictingTournamentId: string; conflictingTournamentName: string }>;
  adjustmentDeadline?: string | null;
  waitlistReason?: "TOURNAMENT_CAPACITY" | "INSTITUTION_CAPACITY" | null;
  waitlistReady?: boolean;
};

export type TeamRegistrationVersion = {
  version: number;
  action: "SUBMITTED" | "RESUBMITTED" | "APPROVED" | "REJECTED" | "REVISION_REQUIRED" | "NEEDS_SUPPLEMENT" | "WITHDRAWN" | "LOCKED" | "APPROVAL_REVIEW_OPENED" | "APPROVAL_REVIEW_RESPONSE" | "APPROVAL_REVIEW_RETAINED" | "APPROVAL_REVOKED" | "WAITLISTED" | "CONFLICT_ADJUSTMENT_REQUIRED" | "ADJUSTMENT_RESUBMITTED" | "ADJUSTMENT_EXPIRED";
  rosterSnapshot: Array<Record<string, unknown>>;
  note: string | null;
  actorId: string;
  createdAt: string;
  statusBefore?: string | null;
  statusAfter?: string | null;
};

export type RegistrationChangeRequest = {
  id: string; registrationId: string; requestKind: "APPROVED_AMENDMENT" | "LOCKED_PLAYER_ADDITION";
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED"; baseVersion: number;
  previousRoster: Array<Record<string, unknown>>; proposedRoster: Array<Record<string, unknown>>;
  reason: string; requestedBy: string; desiredDecision: string | null; decidedBy: string | null;
  decisionNote: string | null; createdAt: string; decidedAt: string | null; effectiveAt: string | null;
};

export type TeamWithdrawalRequest = {
  id: string;
  registrationId: string;
  teamId: string;
  tournamentId: string;
  requestedBy: string;
  reason: string;
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED" | "CANCELLED";
  desiredDecision: "APPROVED" | "REJECTED" | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export type ApprovalReview = {
  id: string;
  registrationId: string;
  requestedBy: string;
  reason: string;
  responseDeadline: string;
  supplementDeadline: string | null;
  status: "OPEN" | "RESPONDED" | "RETAINED" | "REVOKED" | "SUPPLEMENT_REQUIRED";
  teamResponse: string | null;
  respondedAt: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  events?: ApprovalReviewEvent[];
};

export type ApprovalReviewEvent = {
  id: string;
  reviewId: string;
  registrationId: string;
  eventType: "OPENED" | "TEAM_RESPONDED" | "SUPPLEMENT_REQUESTED" | "RETAINED" | "REVOKED";
  statusBefore: string;
  statusAfter: string;
  actorId: string;
  note: string | null;
  rosterSnapshot: Array<Record<string, unknown>>;
  createdAt: string;
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
  competitionRole?: "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN";
  jerseyNumberSnapshot?: number | null;
  positionSnapshot?: string | null;
  playerNameSnapshot?: string | null;
  studentIdSnapshot?: string | null;
};

export type TournamentPlayerInvitation = {
  id: string; tournament_id: string; team_id: string; player_id: string; player_user_id: string;
  competition_role: "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN";
  lineup_role: "STARTER" | "SUBSTITUTE"; is_goalkeeper: boolean;
  proposed_jersey_number: number | null; position_snapshot: string | null;
  message: string | null; status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED" | "INVALIDATED" | "WITHDRAWN";
  expires_at: string; responded_at: string | null; team_name?: string; tournament_name?: string | null;
  tournament_start_date?: string | null; tournament_end_date?: string | null; full_name?: string; student_id?: string;
  registration_status?: string | null; can_request_withdrawal?: boolean;
  conflict_tournament_id?: string | null; conflict_tournament_name?: string | null; status_reason?: string | null;
};

export type TournamentRegistrationDraft = {
  teamId: string;
  tournamentId: string;
  updatedBy: string;
  roster: Array<{
    playerId: string;
    competitionRole: "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN";
    lineupRole: "STARTER" | "SUBSTITUTE";
    isGoalkeeper: boolean;
    proposedJerseyNumber: number | null;
    position: string | null;
  }>;
  notes: string;
  updatedAt: string;
  registrationId: string | null;
  baseVersion: number | null;
  editingSubmitted: boolean;
  draftState: "DRAFT" | "DRAFT_CHANGES";
};

export function getTournamentRegistrationDraft(teamId: string, tournamentId: string) {
  return apiFetch<{ draft: TournamentRegistrationDraft | null }>(`/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/registration-draft`);
}

export function saveTournamentRegistrationDraft(teamId: string, tournamentId: string, roster: TournamentRegistrationDraft["roster"], notes: string) {
  return apiFetch<{ draft: TournamentRegistrationDraft }>(`/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/registration-draft`, {
    method: "PUT", body: JSON.stringify({ roster, notes }),
  });
}

export function deleteTournamentRegistrationDraft(teamId: string, tournamentId: string) {
  return apiFetch<void>(`/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/registration-draft`, { method: "DELETE" });
}

export type PlayerTournamentWithdrawalRequest = {
  id: string; invitationId: string; playerUserId: string; reason: string;
  status: "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED";
  desiredDecision: "APPROVED" | "REJECTED" | null; decisionNote: string | null;
  decidedBy: string | null; createdAt: string; decidedAt: string | null;
  teamId?: string; tournamentId?: string; playerId?: string; playerName?: string;
  teamName?: string; tournamentName?: string | null; position?: string | null;
};

export function createTournamentInvitations(teamId: string, tournamentId: string, players: Array<{
  playerId: string; competitionRole: "PLAYER" | "PLAYING_CAPTAIN" | "VICE_CAPTAIN";
  lineupRole: "STARTER" | "SUBSTITUTE"; isGoalkeeper: boolean; proposedJerseyNumber: number | null;
  position: string | null;
}>, message?: string) {
  return apiFetch<{ invitations: TournamentPlayerInvitation[]; notificationQueued: boolean }>(
    `/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/invitations`,
    { method: "POST", body: JSON.stringify({ players, message }) },
  );
}

export function getTeamTournamentInvitations(teamId: string, tournamentId: string) {
  return apiFetch<{ invitations: TournamentPlayerInvitation[] }>(`/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/invitations`);
}

export function getTournamentEligiblePlayers(teamId: string, tournamentId: string) {
  return apiFetch<{ eligiblePlayerIds: string[]; unavailablePlayerIds: string[] }>(`/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/eligible-players`);
}

export function manageTeamTournamentInvitation(teamId: string, tournamentId: string, invitationId: string, action: "remind" | "cancel") {
  return apiFetch<{ invitation: TournamentPlayerInvitation }>(`/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/invitations/${encodeURIComponent(invitationId)}/${action}`, { method: "POST" });
}

export function getMyTournamentInvitations() {
  return apiFetch<{ invitations: TournamentPlayerInvitation[] }>("/tournament-invitations/my");
}

export function respondToTournamentInvitation(id: string, status: "ACCEPTED" | "DECLINED") {
  return apiFetch<{ invitation: TournamentPlayerInvitation; invalidatedInvitations?: TournamentPlayerInvitation[] }>(`/tournament-invitations/${encodeURIComponent(id)}/respond`, {
    method: "POST", body: JSON.stringify({ status }),
  });
}

export function requestPlayerTournamentWithdrawal(invitationId: string, reason: string) {
  return apiFetch<{ withdrawalRequest: PlayerTournamentWithdrawalRequest }>(`/tournament-invitations/${encodeURIComponent(invitationId)}/withdrawal-requests`, {
    method: "POST", body: JSON.stringify({ reason }),
  });
}

export function getMyPlayerTournamentWithdrawals() {
  return apiFetch<{ withdrawalRequests: PlayerTournamentWithdrawalRequest[] }>("/tournament-invitations/withdrawal-requests/my");
}

export function getTeamPlayerTournamentWithdrawals(teamId: string, tournamentId: string) {
  return apiFetch<{ withdrawalRequests: PlayerTournamentWithdrawalRequest[] }>(`/teams/${encodeURIComponent(teamId)}/tournaments/${encodeURIComponent(tournamentId)}/player-withdrawal-requests`);
}

export function decidePlayerTournamentWithdrawal(requestId: string, decision: "APPROVED" | "REJECTED", note: string) {
  return apiFetch<{ withdrawalRequest: PlayerTournamentWithdrawalRequest }>(`/player-withdrawal-requests/${encodeURIComponent(requestId)}/decision`, {
    method: "POST", body: JSON.stringify({ decision, note }),
  });
}

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

export function getDrawTestConfiguration(tournamentId: string): Promise<DrawTestConfigurationResponse> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/test-configuration`);
}

export function saveDrawTestConfiguration(tournamentId: string, input: DrawTestConfiguration): Promise<{ config: DrawTestConfiguration }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/test-configuration`, {
    method: "PUT", body: JSON.stringify(input),
  });
}

export function resetDrawTestConfiguration(tournamentId: string): Promise<{ reset: true }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/test-configuration`, { method: "DELETE" });
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

export function confirmTournamentDraw(tournamentId: string, method: DrawVersion["method"]): Promise<{ draw: DrawVersion }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/confirm`, {
    method: "POST",
    body: JSON.stringify({ method }),
  });
}

export function publishTournamentDraw(tournamentId: string, method: DrawVersion["method"]): Promise<{ draw: DrawVersion }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/publish`, {
    method: "POST",
    body: JSON.stringify({ method }),
  });
}

export function getTournamentLiveDraw(tournamentId: string): Promise<{ session: LiveDrawSession | null }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/live-draw`);
}

export function getManagedTournamentLiveDraw(tournamentId: string): Promise<{ session: LiveDrawSession | null }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/live-session`);
}

export function startTournamentLiveDraw(tournamentId: string, input: DrawPlanInput, schedule: LiveDrawScheduleInput): Promise<{ session: LiveDrawSession }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/live-session`, { method: "POST", body: JSON.stringify({ ...input, ...schedule }) });
}

export function startScheduledTournamentLiveDraw(tournamentId: string): Promise<{ session: LiveDrawSession }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/live-session/start`, { method: "POST" });
}

export function updateTournamentLiveDrawSchedule(tournamentId: string, status: "SCHEDULED" | "POSTPONED" | "CANCELLED", schedule?: LiveDrawScheduleInput, cancellationReason?: string): Promise<{ session: LiveDrawSession }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/live-session/schedule`, { method: "PATCH", body: JSON.stringify({ status, ...schedule, cancellationReason }) });
}

export function advanceTournamentLiveDraw(tournamentId: string, expectedSequence: number, requestKey: string): Promise<{ session: LiveDrawSession; draw: DrawVersion | null; idempotentReplay: boolean }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/live-session/next`, { method: "POST", headers: { "Idempotency-Key": requestKey }, body: JSON.stringify({ expectedSequence, requestKey }) });
}

export function controlTournamentLiveDraw(tournamentId: string, status: "PAUSED" | "LIVE" | "CANCELLED"): Promise<{ session: LiveDrawSession }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/live-session`, { method: "PATCH", body: JSON.stringify({ status }) });
}

export function finalizeTournamentLiveDraw(tournamentId: string): Promise<{ session: LiveDrawSession; draw: DrawVersion }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/live-session/finalize`, { method: "POST" });
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

export type FixtureStage = "GROUP" | "KNOCKOUT";
export type FixturePublication = {
  drawVersionId: string;
  stage: FixtureStage;
  legs: 1 | 2;
  regulationVersion: number | null;
  status: "DRAFT" | "PUBLISHED";
  createdAt: string;
  publishedAt: string | null;
  matches: Match[];
};

export type PublicFixtureBundle = {
  stages: FixturePublication[];
  bracket: KnockoutBracketSlot[];
};

export function getPublicTournamentFixtures(tournamentId: string): Promise<PublicFixtureBundle> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/public`);
}

export function getManagedTournamentFixtures(tournamentId: string): Promise<{
  stages: FixturePublication[];
  bracket: KnockoutBracketSlot[];
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/manage`);
}

export function getTournamentGroupFairPlay(tournamentId: string): Promise<{
  drawVersionId: string;
  fairPlayPoints: Record<string, number>;
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/group-fair-play`);
}

export type FixtureStanding = { teamId: string; groupRank: number; played: number; won: number; drawn: number; lost: number; goalsFor: number; goalsAgainst: number; goalDifference: number; points: number };
export function getFixtureGroupStandings(tournamentId: string): Promise<{ drawVersionId: string; groups: Array<{ groupId: string; name: string; complete: boolean; standings: FixtureStanding[] }> }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/group-standings`);
}
export function validateTournamentFixtures(tournamentId: string): Promise<{ valid: boolean; message: string }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/validate`, { method: "POST", body: JSON.stringify({}) });
}
export function publishTournamentFixtureStructure(tournamentId: string): Promise<{
  publications: Array<{ drawVersionId: string; stage: FixtureStage; status: "PUBLISHED"; publishedAt: string; matchCount: number }>;
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/fixtures/publish`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export type KnockoutBracketSlot = {
  id: string; roundNumber: number; position: number; homeTeamId: string | null; awayTeamId: string | null;
  winnerTeamId: string | null; matchId: string | null; matchStatus: string | null; status: string;
  homeSourceSlotId: string | null; awaySourceSlotId: string | null;
  slotType: "STANDARD" | "THIRD_PLACE"; homeSourceOutcome: "WINNER" | "LOSER"; awaySourceOutcome: "WINNER" | "LOSER";
    homeQualification: { groupId: string; groupRank: number } | null;
    awayQualification: { groupId: string; groupRank: number } | null;
};

export function getTournamentBracket(tournamentId: string): Promise<{ slots: KnockoutBracketSlot[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/bracket`);
}

export type HybridLotDrawResolution = {
  groupId: string;
  tiedTeamIds: string[];
  drawnOrder: string[];
  witnessName: string;
  reason: string;
};

export type HybridLotDrawAudit = HybridLotDrawResolution & {
  tournamentId: string;
  drawVersionId: string;
  drawnBy: string;
  drawnAt: string;
};

export function getHybridLotDrawHistory(tournamentId: string): Promise<{ lotDraws: HybridLotDrawAudit[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/knockout-stage/lot-draws`);
}

export function generateHybridPlayoffs(tournamentId: string, lotDrawResolutions: HybridLotDrawResolution[] = []): Promise<{
  drawVersionId: string;
  matches: Match[];
  alreadyGenerated: boolean;
  qualifications: Array<{ teamId: string; groupId: string; groupRank: number }>;
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/knockout-stage/generate`, {
    method: "POST",
    body: JSON.stringify({ lotDrawResolutions }),
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
  input: { name?: string; description?: string; location?: string; status?: string; maxTeams?: number; startDate?: string; endDate?: string; competitionFormat?: Tournament["competitionFormat"]; competitionConfig?: TournamentCompetitionConfig; roundRobinLegs?: 1 | 2; maxTeamsPerGroup?: number | null; advancingTeamsPerGroup?: number; knockoutDecisionMethod?: TournamentRules["knockoutDecisionMethod"]; extraTimeMinutes?: number },
): Promise<{ tournament: Tournament }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function getRegistrationControlAvailability(tournamentId: string): Promise<{
  enabled: boolean;
  canClose: boolean;
  canReopen: boolean;
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/registration-control`);
}

export function controlRegistrationForTest(
  tournamentId: string,
  action: "TEST_CLOSE" | "TEST_REOPEN",
): Promise<{ tournament: Tournament }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/registration-control`, {
    method: "POST",
    body: JSON.stringify({ action }),
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

export async function getAllMatches(tournamentId: string): Promise<{ items: Match[]; total: number }> {
  const pageSize = 100;
  const firstPage = await apiFetch<{ items: Match[]; total: number }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/matches?limit=${pageSize}&offset=0`,
  );
  if (firstPage.items.length >= firstPage.total) return firstPage;
  const offsets: number[] = [];
  for (let offset = pageSize; offset < firstPage.total; offset += pageSize) offsets.push(offset);
  const pages = await Promise.all(offsets.map((offset) => apiFetch<{ items: Match[]; total: number }>(
    `/tournaments/${encodeURIComponent(tournamentId)}/matches?limit=${pageSize}&offset=${offset}`,
  )));
  return { items: [...firstPage.items, ...pages.flatMap((page) => page.items)], total: firstPage.total };
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

export function editPlayerTeamRequest(requestId: string, input: {
  teamId: string;
  fullName: string;
  birthDate?: string;
  studentId?: string;
  profileData?: Record<string, string | null>;
  message?: string;
}): Promise<{ request: PlayerTeamRequest }> {
  return apiFetch(`/player-requests/${encodeURIComponent(requestId)}`, {
    method: "PATCH",
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

export function getTournamentWithdrawalRequests(tournamentId: string): Promise<{ withdrawalRequests: TeamWithdrawalRequest[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/withdrawal-requests`);
}

export function getTournamentRegistrationReviewSummary(tournamentId: string): Promise<{ pendingApprovalReviewCount: number }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/registration-review-summary`);
}

export function getTeamRegistrationHistory(registrationId: string) {
  return apiFetch<{ versions: TeamRegistrationVersion[] }>(`/registrations/${encodeURIComponent(registrationId)}/history`);
}

export function createRegistrationChangeRequest(registrationId: string, requestKind: RegistrationChangeRequest["requestKind"], playerIds: string[], reason: string): Promise<{ changeRequest: RegistrationChangeRequest }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/change-requests`, { method:"POST", body:JSON.stringify({requestKind,playerIds,reason}) });
}
export function getRegistrationChangeRequests(registrationId: string): Promise<{ changeRequests: RegistrationChangeRequest[] }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/change-requests`);
}
export function getTournamentRegistrationChangeRequests(tournamentId: string): Promise<{ changeRequests: RegistrationChangeRequest[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/registration-change-requests`);
}
export function decideRegistrationChangeRequest(id: string, decision: "APPROVED"|"REJECTED", note: string): Promise<{ changeRequest: RegistrationChangeRequest }> {
  return apiFetch(`/registration-change-requests/${encodeURIComponent(id)}/decision`, {method:"POST",body:JSON.stringify({decision,note})});
}

export function getTeamRegistrationApprovalReviews(registrationId: string): Promise<{ reviews: ApprovalReview[] }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/approval-reviews`);
}

export function openTeamRegistrationApprovalReview(registrationId: string, reason: string, responseDeadline: string): Promise<{ review: ApprovalReview }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/approval-reviews`, {
    method: "POST", body: JSON.stringify({ reason, responseDeadline }),
  });
}

export function respondTeamRegistrationApprovalReview(reviewId: string, response: string): Promise<{ review: ApprovalReview }> {
  return apiFetch(`/approval-reviews/${encodeURIComponent(reviewId)}/response`, {
    method: "POST", body: JSON.stringify({ response }),
  });
}

export function decideTeamRegistrationApprovalReview(reviewId: string, decision: "RETAIN_APPROVAL" | "REVOKE_APPROVAL" | "REQUEST_SUPPLEMENT", note: string, supplementDeadline?: string): Promise<{ review: ApprovalReview; registration: TeamRegistration }> {
  return apiFetch(`/approval-reviews/${encodeURIComponent(reviewId)}/decision`, {
    method: "POST", body: JSON.stringify({ decision, note, supplementDeadline }),
  });
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

export function resubmitTeamRegistration(registrationId: string): Promise<{ registration: TeamRegistration }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/resubmit`, { method: "POST" });
}

export function withdrawTeamRegistration(registrationId: string, reason: string): Promise<{ registration: TeamRegistration }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function requestTeamRegistrationWithdrawal(registrationId: string, reason: string): Promise<{ withdrawalRequest: TeamWithdrawalRequest }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/withdrawal-requests`, {
    method: "POST", body: JSON.stringify({ reason }),
  });
}

export function getRegistrationWithdrawalRequests(registrationId: string): Promise<{ withdrawalRequests: TeamWithdrawalRequest[] }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}/withdrawal-requests`);
}

export function decideTeamWithdrawalRequest(requestId: string, decision: "APPROVED" | "REJECTED", note: string): Promise<{ withdrawalRequest: TeamWithdrawalRequest }> {
  return apiFetch(`/withdrawal-requests/${encodeURIComponent(requestId)}/decision`, {
    method: "POST", body: JSON.stringify({ decision, note }),
  });
}

export function cancelTeamWithdrawalRequest(requestId: string): Promise<{ withdrawalRequest: TeamWithdrawalRequest }> {
  return apiFetch(`/withdrawal-requests/${encodeURIComponent(requestId)}/cancel`, { method: "POST", body: JSON.stringify({}) });
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
  status: "APPROVED" | "REJECTED" | "REVISION_REQUIRED" | "NEEDS_SUPPLEMENT",
  notes?: string,
  supplementDeadline?: string,
  resubmissionAllowed?: boolean,
): Promise<{ registration: TeamRegistration }> {
  return apiFetch(`/registrations/${encodeURIComponent(registrationId)}`, {
    method: "PUT",
    body: JSON.stringify({ status, notes, supplementDeadline, resubmissionAllowed }),
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
  myAssignment?: { position: string; isFinalAuthority: boolean };
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
  isLocked?: boolean;
};

export type ScheduleRefereeAssignment = {
  id: string;
  scheduleId: string;
  refereeId: string;
  position: string;
  isFinalAuthority: boolean;
  assignedBy: string;
  assignedAt: string;
};

export type ScheduleRefereeAssignmentHistory = {
  id: string;
  beforeAssignments: Array<{ refereeId: string; position: string; isFinalAuthority: boolean }>;
  afterAssignments: Array<{ refereeId: string; position: string; isFinalAuthority: boolean }>;
  changedBy: string;
  reason: string | null;
  changedAt: string;
};

export type ScheduleChangeHistory = {
  id: string;
  before: Pick<TournamentSchedule, "venueId" | "scheduledDate" | "durationMinutes" | "status">;
  after: Pick<TournamentSchedule, "venueId" | "scheduledDate" | "durationMinutes" | "status">;
  changedBy: string;
  reason: string | null;
  changedAt: string;
};

export type RefereeCandidate = { userId: string; fullName: string; email: string };

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

export function getTournamentVenues(isActive?: boolean): Promise<{ venues: Venue[] }> {
  return apiFetch(`/venues${isActive === undefined ? "" : `?isActive=${isActive}`}`);
}

export function createTournamentVenue(input: { name: string; location: string; capacity?: number; surface?: string }): Promise<{ venue: Venue }> {
  return apiFetch("/venues", { method: "POST", body: JSON.stringify(input) });
}

export function updateTournamentVenue(id: string, input: { name?: string; location?: string; capacity?: number; surface?: string; isActive?: boolean }): Promise<{ venue: Venue }> {
  return apiFetch(`/venues/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) });
}

export function getManagedTournamentSchedules(
  tournamentId: string,
): Promise<{ schedules: TournamentSchedule[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules/manage`);
}

/** Official scheduling context. Fixture IDs and resource revisions are owned by Match Service. */
export type OfficialSchedulingContext = {
  tournamentId: string; drawVersionId: string; diagramVersion: string;
  fixtures: import("@sfl/shared").DemoFixture[];
  entries: Record<string, import("@sfl/shared").DemoScheduleEntry>;
  resources: import("@sfl/shared").DemoScheduleResources | null;
  resourceRevision: number; revision: number; baseSignature: string;
  schedulePublishedAt: string | null; schedules: TournamentSchedule[];
  pitchType: 5 | 7 | 11; startDate: string; endDate: string; rules: TournamentRules;
  tournamentContext: import("@sfl/shared").ScheduleSetupTournamentContext;
};

export function getOfficialSchedulingContext(tournamentId: string): Promise<OfficialSchedulingContext> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules/context`);
}

export function requestOfficialScheduling<T>(tournamentId: string, action: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules/${action}`, { method: "POST", body: JSON.stringify(input), signal });
}

export function saveOfficialScheduleDraft(tournamentId: string, input: { entries: Record<string, import("@sfl/shared").DemoScheduleEntry>; baseSignature: string; diagramVersion: string }): Promise<unknown> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules/draft`, { method: "PUT", body: JSON.stringify(input) });
}

export function getTournamentScheduleResources<T>(tournamentId: string): Promise<{ resources: T | null; revision: number; updatedAt: string | null }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/scheduling-resources`);
}

export function saveTournamentScheduleResources<T>(
  tournamentId: string,
  resources: T,
  expectedRevision: number | null,
): Promise<{ tournamentId: string; resources: T; revision: number; updatedAt: string }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/scheduling-resources`, {
    method: "PUT",
    body: JSON.stringify({ resources, expectedRevision }),
  });
}

export function setTournamentScheduleLock(scheduleId: string, isLocked: boolean): Promise<{ schedule: TournamentSchedule }> {
  return apiFetch(`/schedules/${encodeURIComponent(scheduleId)}/lock`, {
    method: "PUT",
    body: JSON.stringify({ isLocked }),
  });
}

export function previewOfficialTournamentSchedule(tournamentId: string, configuration: AutoScheduleConfiguration): Promise<{
  tournamentId: string;
  drawVersionId: string;
  resourceRevision: number;
  baseSignature: string;
  plan: AutomaticSchedulePlan;
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules/automatic-preview`, {
    method: "POST",
    body: JSON.stringify({ configuration }),
  });
}

export function publishOfficialTournamentSchedules(tournamentId: string): Promise<{
  publishedCount: number;
  totalCount: number;
  schedules: TournamentSchedule[];
}> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules/publish`, { method: "POST", body: JSON.stringify({}) });
}

export function checkTournamentScheduleConflicts(input: {
  tournamentId: string;
  matchId: string;
  venueId: string;
  scheduledDate: string;
  durationMinutes: number;
  refereeId?: string;
}): Promise<{ hasConflict: boolean; conflicts: Array<{ type: "venue" | "team" | "referee"; scheduleId: string; reason: string }> }> {
  return apiFetch("/schedules/check-conflicts", { method: "POST", body: JSON.stringify(input) });
}

export function getPublicTournamentSchedules(tournamentId: string): Promise<{ schedules: TournamentSchedule[] }> {
  return apiFetch(`/tournaments/${encodeURIComponent(tournamentId)}/schedules`);
}

export function searchRefereeCandidates(search = ""): Promise<{ users: RefereeCandidate[] }> {
  const query = new URLSearchParams();
  if (search.trim()) query.set("search", search.trim());
  return apiFetch(`/schedules/referee-candidates${query.size ? `?${query}` : ""}`);
}

export function getScheduleReferees(scheduleId: string): Promise<{ assignments: ScheduleRefereeAssignment[] }> {
  return apiFetch(`/schedules/${encodeURIComponent(scheduleId)}/referees`);
}

export function getScheduleRefereeHistory(scheduleId: string): Promise<{ history: ScheduleRefereeAssignmentHistory[] }> {
  return apiFetch(`/schedules/${encodeURIComponent(scheduleId)}/referee-history`);
}

export function getScheduleChangeHistory(scheduleId: string): Promise<{ history: ScheduleChangeHistory[] }> {
  return apiFetch(`/schedules/${encodeURIComponent(scheduleId)}/change-history`);
}

export function assignScheduleReferees(
  scheduleId: string,
  assignments: Array<{ refereeId: string; position: string; isFinalAuthority: boolean }>,
  reason?: string,
): Promise<{ assignments: ScheduleRefereeAssignment[]; notificationFailures: string[] }> {
  return apiFetch(`/schedules/${encodeURIComponent(scheduleId)}/referees`, {
    method: "PUT",
    body: JSON.stringify({ assignments, reason }),
  });
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
  changes: {
    status?: TournamentSchedule["status"];
    refereeId?: string | null;
    venueId?: string;
    scheduledDate?: string;
    durationMinutes?: number;
    reason?: string;
  },
): Promise<{ schedule: TournamentSchedule; notificationFailures?: string[] }> {
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

export function correctMatchEvent(id:string,input:Parameters<typeof createMatchEvent>[0]&{expectedRevision:number;correctionReason:string}):Promise<{event:MatchEvent}>{return apiFetch(`/match-events/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(input)});}

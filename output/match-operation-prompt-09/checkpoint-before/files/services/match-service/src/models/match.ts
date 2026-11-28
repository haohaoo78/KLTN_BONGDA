import type { MatchClockPhase,MatchClockState } from "@sfl/shared";
export type { MatchClockPhase,MatchClockAction,MatchClockState,MatchClockActionOptions } from "@sfl/shared";
export type MatchStatus = "UNSCHEDULED" | "SCHEDULED" | "LINEUP_CONFIRMED" | "IN_PROGRESS" | "FINISHED" | "VERIFIED" | "LOCKED" | "CANCELLED" | "POSTPONED";

export interface Match {
  id: string;
  tournamentId: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  matchDate: string | null;
  venue: string | null;
  round: string | null;
  status: MatchStatus;
  createdAt: string;
  updatedAt: string;
  /** Fixture structure metadata; absent for manually created legacy matches. */
  stage?: "GROUP" | "KNOCKOUT";
  drawVersionId?: string | null;
  groupId?: string | null;
  roundNumber?: number | null;
  leg?: number | null;
  fixtureKey?: string | null;
}

export interface MatchCreateInput {
  tournamentId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string;
  venue?: string;
  round?: string;
}

export interface GeneratedFixtureInput {
  tournamentId: string;
  drawVersionId: string;
  groupId: string;
  groupName: string;
  round: string;
  leg: number;
  roundNumber: number;
  homeTeamId: string;
  awayTeamId: string;
}

export interface FixtureGenerationResult {
  drawVersionId: string;
  legs: 1 | 2;
  matches: Match[];
  alreadyGenerated: boolean;
}

export interface MatchUpdateInput {
  matchDate?: string;
  venue?: string;
  round?: string;
  status?: MatchStatus;
}

export interface MatchResult {
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
}

export interface MatchResultCreateInput {
  matchId: string;
  homeScore: number;
  awayScore: number;
  homeExtraTimeScore?: number;
  awayExtraTimeScore?: number;
  homePenaltyScore?: number;
  awayPenaltyScore?: number;
  notes?: string;
}

export interface MatchResultCorrectionRequest {
  id: string;
  matchId: string;
  tournamentId: string;
  requestedBy: string;
  originalResult: Omit<MatchResult, "id" | "recordedBy" | "recordedAt" | "status">;
  proposedResult: Omit<MatchResultCreateInput, "matchId">;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  cascadeSnapshot?: Array<{ matchId: string; previousHomeTeamId: string | null; previousAwayTeamId: string | null; nextHomeTeamId: string | null; nextAwayTeamId: string | null }>;
  createdAt: string;
}

export interface Lineup {
  id: string;
  matchId: string;
  teamId: string;
  playerId: string;
  position: string | null;
  jerseyNumber: number | null;
  isStarting: boolean;
  confirmedBy: string | null;
  confirmedAt: string | null;
  createdAt: string;
}

export interface LineupCreateInput {
  matchId: string;
  teamId: string;
  playerId: string;
  position?: string;
  jerseyNumber?: number;
  isStarting?: boolean;
}

export type MatchEventType = "GOAL" | "YELLOW_CARD" | "SECOND_YELLOW_CARD" | "RED_CARD" | "SUBSTITUTION_IN" | "SUBSTITUTION_OUT" | "OWN_GOAL" | "PENALTY_GOAL" | "INJURY" | "PLAYER_LEAVE" | "REPLACEMENT_IN" | "PLAYER_RETURN" | "INCIDENT";

export interface MatchEvent {
  operationId?:string|null;substitutionId?:string|null;relatedPlayerId?:string|null;opportunityId?:string|null;revision?:number;visibility?:'PUBLIC'|'CREW';supersedesEventId?:string|null;
  phase?:MatchClockPhase|null;
  periodElapsedSeconds?:number|null;
  addedTimeSeconds?:number|null;
  eventSequence?:string|null;
  id: string;
  matchId: string;
  teamId: string;
  playerId: string | null;
  eventType: MatchEventType;
  minute: number | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
}

export interface MatchEventCreateInput {
  operationId?:string;relatedPlayerId?:string;opportunityId?:string;visibility?:'PUBLIC'|'CREW';supersedesId?:string;correctionReason?:string;expectedRevision?:number;
  phase?:MatchClockPhase;
  periodElapsedSeconds?:number;
  expectedClockVersion?:number;
  matchId: string;
  teamId: string;
  playerId?: string;
  eventType: MatchEventType;
  minute?: number;
  description?: string;
}

export interface MatchEventVoidInput {
  id: string;
  voidedBy: string;
  reason: string;
}

export type MatchReportStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "REVISION_REQUIRED";

export interface MatchReportSubmissionSnapshot {
  version?: number;
  context?: Record<string, unknown>;
  report?: { attendance: number | null; weather: string | null; notes: string | null; submittedBy: string; requiresOrganizerReview: boolean; homeScoreAtHalfTime: number | null; awayScoreAtHalfTime: number | null };
  periods?: Array<Record<string, unknown>>;
  shootout?: unknown;
  submittedAt: string;
  result: {
    homeScore: number;
    awayScore: number;
    homeExtraTimeScore: number | null;
    awayExtraTimeScore: number | null;
    homePenaltyScore: number | null;
    awayPenaltyScore: number | null;
  } | null;
  lineups: Array<Pick<Lineup, "teamId" | "playerId" | "position" | "jerseyNumber" | "isStarting" | "confirmedBy" | "confirmedAt"> & {fullName?:string|null}>;
  events: Array<Pick<MatchEvent, "teamId" | "playerId" | "eventType" | "minute" | "description" | "createdBy" | "createdAt" | "phase" | "periodElapsedSeconds" | "addedTimeSeconds" | "eventSequence" | "visibility"> & {id?:string;playerName?:string|null;relatedPlayerId?:string|null;substitutionId?:string|null}>;
  clock: Pick<MatchClockState, "phase" | "elapsedSeconds" | "totalElapsedSeconds" | "updatedAt"> | null;
}

export interface MatchReport {
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
  status: MatchReportStatus;
  reviewNote: string | null;
  submissionSnapshots: MatchReportSubmissionSnapshot[];
  version: number;
  requiresOrganizerReview: boolean;
  draft: { attendance: number | null; weather: string | null; notes: string | null; requiresOrganizerReview?:boolean } | null;
  reviewHistory: Array<{ id: string; status: string; reviewNote: string | null; reviewedBy: string; reviewedAt: string; reportVersion: number | null }>;
}

export interface MatchReportCreateInput {
  matchId: string;
  refereeId: string;
  homeCaptainId?: string;
  awayCaptainId?: string;
  homeScoreAtHalfTime?: number;
  awayScoreAtHalfTime?: number;
  attendance?: number;
  weather?: string;
  notes?: string;
  requiresOrganizerReview?: boolean;
  action?: "SAVE_DRAFT" | "SUBMIT";
  expectedVersion?: number;
  operationId?: string;
}

export interface MatchReportUpdateInput {
  status?: MatchReportStatus;
  verifiedBy?: string;
  reviewNote?: string | null;
  expectedVersion?: number;
  operationId?: string;
}

export interface Standing {
  id: string;
  tournamentId: string;
  teamId: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  updatedAt: string;
}

export interface StandingUpdateInput {
  played?: number;
  won?: number;
  drawn?: number;
  lost?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  goalDifference?: number;
  points?: number;
}

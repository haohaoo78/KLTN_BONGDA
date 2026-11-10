export type MatchStatus = "UNSCHEDULED" | "SCHEDULED" | "LINEUP_CONFIRMED" | "IN_PROGRESS" | "FINISHED" | "VERIFIED" | "LOCKED" | "CANCELLED" | "POSTPONED";

export interface Match {
  id: string;
  tournamentId: string;
  homeTeamId: string;
  awayTeamId: string;
  matchDate: string | null;
  venue: string | null;
  round: string | null;
  status: MatchStatus;
  createdAt: string;
  updatedAt: string;
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

export type MatchEventType = "GOAL" | "YELLOW_CARD" | "RED_CARD" | "SUBSTITUTION_IN" | "SUBSTITUTION_OUT" | "OWN_GOAL" | "PENALTY_GOAL";

export interface MatchEvent {
  id: string;
  matchId: string;
  teamId: string;
  playerId: string | null;
  eventType: MatchEventType;
  minute: number | null;
  description: string | null;
  createdBy: string;
  createdAt: string;
}

export interface MatchEventCreateInput {
  matchId: string;
  teamId: string;
  playerId?: string;
  eventType: MatchEventType;
  minute?: number;
  description?: string;
}

export type MatchReportStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVISION_REQUIRED";

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
}

export interface MatchReportUpdateInput {
  status?: MatchReportStatus;
  verifiedBy?: string;
  reviewNote?: string | null;
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

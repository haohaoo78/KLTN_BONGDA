export type DrawMethod = "RANDOM" | "SEEDED" | "MANUAL";
export type DrawPlanMethod = "RANDOM" | "MANUAL";
export type DrawWorkflowStatus = "DRAFT" | "CONFIRMED" | "PUBLISHED" | "ARCHIVED";
export type LiveDrawStatus = "SCHEDULED" | "POSTPONED" | "LIVE" | "PAUSED" | "COMPLETED" | "CANCELLED" | "FINALIZED";

export interface DrawCandidate {
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
}

export interface DrawGroupInput {
  name: string;
  teamIds: string[];
  positions?: number[];
}

export interface DrawSeedInput {
  teamId: string;
  seedGroup: number;
}

export interface DrawPlanInput {
  method: DrawPlanMethod;
  groupCount: number;
  maxTeamsPerGroup?: number;
  noSameInstitution?: boolean;
  groups?: DrawGroupInput[];
  seededTeamIds?: string[];
  changeReason?: string;
}

export interface DrawAssignment {
  teamId: string;
  groupId: string;
  groupName: string;
  position: number;
  seedGroup: number | null;
}

export interface DrawGroup {
  id: string;
  name: string;
  maxTeams: number;
  assignments: DrawAssignment[];
}

export interface DrawVersion {
  id: string;
  tournamentId: string;
  version: number;
  status: DrawWorkflowStatus;
  method: DrawMethod;
  config: Record<string, unknown>;
  changeReason: string | null;
  createdBy: string;
  createdAt: string;
  confirmedBy: string | null;
  confirmedAt: string | null;
  publishedBy: string | null;
  publishedAt: string | null;
  groups: DrawGroup[];
}

export interface LiveDrawPick {
  sequence: number;
  groupIndex: number;
  groupName: string;
  teamId: string;
  position: number;
  seedGroup: number | null;
  drawnAt: string;
}

export interface LiveDrawHistoryEvent {
  at: string;
  type: string;
  actorId: string;
  detail: string;
  sequence: number | null;
}

export interface LiveDrawState {
  sessionId: string;
  tournamentId: string;
  status: LiveDrawStatus;
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
  picks: LiveDrawPick[];
  history: LiveDrawHistoryEvent[];
}

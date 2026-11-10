export type DrawMethod = "RANDOM" | "SEEDED" | "MANUAL";
export type DrawWorkflowStatus = "DRAFT" | "CONFIRMED" | "PUBLISHED" | "ARCHIVED";

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
}

export interface DrawSeedInput {
  teamId: string;
  seedGroup: number;
}

export interface DrawPlanInput {
  method: DrawMethod;
  groupCount: number;
  maxTeamsPerGroup?: number;
  noSameInstitution?: boolean;
  groups?: DrawGroupInput[];
  seedings?: DrawSeedInput[];
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

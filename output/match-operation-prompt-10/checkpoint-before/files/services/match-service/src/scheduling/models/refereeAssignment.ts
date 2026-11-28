import type { RefereePosition } from "./refereeConfiguration";
import type { RefereeAccount, RefereeTeamProfile } from "./refereeTeam";

export interface RefereeDraftSlot { position: string; refereeId: string }
export interface RefereeAssignmentDraft {
  scheduleId: string; tournamentId: string; revision: number; configurationRevision: number;
  positions: RefereePosition[]; slots: RefereeDraftSlot[]; occupiedFrom: string; occupiedTo: string;
  minimumRestMinutes: number; publishedAt: string | null; updatedAt: string;
}
export interface RefereeDuty {
  scheduleId: string; matchId: string; tournamentId: string; refereeId: string;
  startsAt: string; endsAt: string; venueId: string; minimumRestMinutes: number;
}
export interface RefereeAssignmentCandidate {
  userId: string; identity: Omit<RefereeAccount, "userId">; profile: RefereeTeamProfile;
}
export interface RefereeEligibilityIssue { code: string; message: string }
export type RefereeAssignmentState = "UNASSIGNED" | "PARTIAL" | "COMPLETE" | "CONFLICT" | "PUBLISHED";

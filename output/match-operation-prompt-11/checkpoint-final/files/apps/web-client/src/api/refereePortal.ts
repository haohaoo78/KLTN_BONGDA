import { apiFetch } from "./client";
import type { Match, RefereeSchedule, MatchResult, MatchReport, MatchClock, MatchLineup, MatchEvent, TournamentRules } from "./competition";

export type RefereeCapability = "READ" | "RECORD_EVENT" | "EDIT_EVENT" | "MANAGE_REPORT" | "FINALIZE";
export type RefereeTeamSide = { id: string | null; name: string; logoUrl: string | null };
export type RefereeAssignment = {
  match: Match; schedule: RefereeSchedule; home: RefereeTeamSide; away: RefereeTeamSide;
  tournament: { id: string; name: string; footballFormat: number; competitionFormat: string };
  roundLabel: string; groupName: string | null; venueName: string; venueLocation: string | null;
  assignment: { position: string; label: string; isFinalAuthority: boolean; capabilities: RefereeCapability[] };
  result: MatchResult | null; report: MatchReport | null;
};
export type RefereeMatchContext = RefereeAssignment & {
  crew: Array<{ refereeId: string; position: string; label: string; fullName: string; isFinalAuthority: boolean; isMe: boolean }>;
  rules: Partial<TournamentRules> | null;
  shootout?: import('./matchShootout').ShootoutWorkspace|null;
  operationRules?: import("@sfl/shared").EffectiveMatchRules;
  readiness?: import("@sfl/shared").MatchOperationReadiness;
  preparation?: import("@sfl/shared").MatchPreparation;
  clock: MatchClock; lineups: Array<MatchLineup & { fullName: string; confirmedAt: string | null; confirmedBy: string | null }>;
  events: Array<MatchEvent & { playerName: string | null }>; playerNames: Record<string, string>;
};
export const getRefereeAssignments = () => apiFetch<{ items: RefereeAssignment[] }>("/my/schedules/workspace");
export const getRefereeContext = (matchId: string) => apiFetch<RefereeMatchContext>(`/matches/${encodeURIComponent(matchId)}/referee-context`);

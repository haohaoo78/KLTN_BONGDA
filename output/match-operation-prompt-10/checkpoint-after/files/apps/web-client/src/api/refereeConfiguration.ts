import { apiFetch } from "./client";

export type RefereeCapability = "RECORD_EVENT" | "EDIT_EVENT" | "MANAGE_REPORT" | "FINALIZE";
export interface RefereePosition { code: string; label: string; required: boolean; capabilities: RefereeCapability[] }
export interface RefereeConfigurationOverride {
  id: string; scope: "STAGE" | "ROUND" | "MATCH"; stage?: "GROUP" | "KNOCKOUT"; roundNumber?: number; matchId?: string; positions: RefereePosition[];
}
export interface RefereeConfiguration { defaultPositions: RefereePosition[]; overrides: RefereeConfigurationOverride[]; minimumRestMinutes?: number }
export interface RefereeConfigurationResponse {
  tournamentId: string; readOnly: boolean; readOnlyReason: string | null; configuration: RefereeConfiguration | null;
  revision: number; updatedAt: string | null;
  fixtures: Array<{ id: string; label: string; stage: "GROUP" | "KNOCKOUT"; roundNumber: number | null }>;
  effective: Array<{ matchId: string; source: "TOURNAMENT" | "STAGE" | "ROUND" | "MATCH"; overrideId: string | null; positions: RefereePosition[] }>;
}
const path = (tournamentId: string) => `/tournaments/${encodeURIComponent(tournamentId)}/referee-team/configuration`;
export const getRefereeConfiguration = (tournamentId: string): Promise<RefereeConfigurationResponse> => apiFetch(path(tournamentId));
export const saveRefereeConfiguration = (tournamentId: string, configuration: RefereeConfiguration, expectedRevision: number): Promise<RefereeConfigurationResponse> => apiFetch(path(tournamentId), { method: "PUT", body: JSON.stringify({ configuration, expectedRevision }) });

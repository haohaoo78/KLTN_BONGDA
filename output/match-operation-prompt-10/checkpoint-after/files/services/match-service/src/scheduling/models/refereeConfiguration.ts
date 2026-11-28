export const REFEREE_CAPABILITIES = ["RECORD_EVENT", "EDIT_EVENT", "MANAGE_REPORT", "FINALIZE"] as const;
export type RefereeCapability = typeof REFEREE_CAPABILITIES[number];
export interface RefereePosition {
  code: string;
  label: string;
  required: boolean;
  capabilities: RefereeCapability[];
}
export interface RefereeConfigurationOverride {
  id: string;
  scope: "STAGE" | "ROUND" | "MATCH";
  stage?: "GROUP" | "KNOCKOUT";
  roundNumber?: number;
  matchId?: string;
  positions: RefereePosition[];
}
export interface RefereeConfiguration {
  defaultPositions: RefereePosition[];
  overrides: RefereeConfigurationOverride[];
  minimumRestMinutes?: number;
}
export interface RefereeFixtureScope {
  id: string;
  stage?: "GROUP" | "KNOCKOUT";
  roundNumber?: number | null;
}
export interface RefereeConfigurationRecord {
  configuration: RefereeConfiguration;
  revision: number;
  updatedAt: string;
  updatedBy: string;
}

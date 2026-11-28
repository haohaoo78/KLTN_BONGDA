import { apiFetch } from "./client";
import type { ScheduleSetupAnalysis } from "@sfl/shared";

export type ServerTestSnapshot<T> = { state: T | null; revision: number; updatedAt: string | null; diagramVersion?: string | null };

export function getDrawWorkflowTestState<T>(tournamentId: string) {
  return apiFetch<ServerTestSnapshot<T>>(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/test-state`);
}

export function getPublicDrawWorkflowTestState<T>(tournamentId: string) {
  return apiFetch<ServerTestSnapshot<T>>(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/test-state/public`);
}

export function saveDrawWorkflowTestState<T>(tournamentId: string, state: T, expectedRevision: number | null) {
  return apiFetch<ServerTestSnapshot<T>>(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/test-state`, {
    method: "PUT", body: JSON.stringify({ state, expectedRevision }),
  });
}

export function resetDrawWorkflowTestState(tournamentId: string) {
  return apiFetch<{ reset: true }>(`/tournaments/${encodeURIComponent(tournamentId)}/draw-management/test-state`, { method: "DELETE" });
}

export function getScheduleWorkflowTestState<T>(tournamentId: string) {
  return apiFetch<ServerTestSnapshot<T>>(`/schedules/test-workflow/${encodeURIComponent(tournamentId)}`);
}

export function getPublicScheduleWorkflowTestState<T>(tournamentId: string) {
  return apiFetch<ServerTestSnapshot<T>>(`/schedules/test-workflow/${encodeURIComponent(tournamentId)}/public`);
}

export function saveScheduleWorkflowTestState<T>(tournamentId: string, state: T, expectedRevision: number | null) {
  return apiFetch<ServerTestSnapshot<T>>(`/schedules/test-workflow/${encodeURIComponent(tournamentId)}`, {
    method: "PUT", body: JSON.stringify({ state, expectedRevision }),
  });
}

export function resetScheduleWorkflowTestState(tournamentId: string, expectedRevision: number) {
  return apiFetch<{ reset: true }>(`/schedules/test-workflow/${encodeURIComponent(tournamentId)}`, { method: "DELETE", body: JSON.stringify({ expectedRevision }) });
}

export function previewScheduleResourceImpact<T>(snapshot: T) {
  return apiFetch<{
    tournamentId: string;
    diagramVersion: string;
    affectedFixtureIds: string[];
    affectedLockedFixtureIds: string[];
    newlyInvalidIssues: Array<{ fixtureId: string; code: string; message: string; severity?: "HARD" | "WARNING" }>;
    resourceIssues: Array<{ fixtureId: string; code: string; message: string; severity?: "HARD" | "WARNING" }>;
    regulationIssues: string[];
    recommendations: string[];
    requiresConfirmation: boolean;
  }>("/schedules/engine/test/resources/preview", { method: "POST", body: JSON.stringify(snapshot) });
}

export function analyzeScheduleSetup<T>(snapshot: T) {
  return apiFetch<{ tournamentId: string; diagramVersion: string; analysis: ScheduleSetupAnalysis }>("/schedules/engine/test/setup-analysis", {
    method: "POST", body: JSON.stringify(snapshot),
  });
}

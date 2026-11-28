import type { DemoFixture, DemoScheduleEntry, DemoScheduleResources, ScheduleSetupTournamentContext } from "@sfl/shared";
import { apiFetch } from "./client";
import type { RefereePosition } from "./refereeConfiguration";
import type { TournamentRules, TournamentSchedule } from "./competition";

export type RefereeAssignmentStatus = "UNASSIGNED" | "PARTIAL" | "COMPLETE" | "CONFLICT" | "PUBLISHED";
export interface RefereeDraftSlot { position: string; refereeId: string }
export interface RefereeCandidateSuggestion {
  userId: string; fullName: string; email: string; organization: string; eligible: boolean;
  issues: Array<{ code: string; message: string }>; totalAssignments: number; restMinutes: number | null;
}
export interface RefereeAssignmentMatch {
  matchId: string; scheduleId: string; fixture: DemoFixture;
  schedule: TournamentSchedule & { durationMinutes: number }; venueName: string; positions: RefereePosition[]; slots: RefereeDraftSlot[];
  revision: number; configurationRevision: number; scheduleSignature: string;
  assigned: number; required: number; complete: boolean; missing: string[]; status: RefereeAssignmentStatus;
  issues: Array<{ code: string; message: string }>; updatedAt: string | null;
  isPublished: boolean; publication: { revision: number; publishedBy: string; publishedAt: string } | null;
  crew: Array<RefereeDraftSlot & { label: string; fullName: string }>;
  deliveries: Array<{ id: string; refereeId: string; position: string; kind: "PUBLISHED" | "REPLACED_IN" | "REPLACED_OUT"; fullName: string; notificationStatus: "PENDING" | "SENT" | "FAILED"; emailStatus: "PENDING" | "SENT" | "FAILED"; errorCode: string | null; sentAt: string | null }>;
}
export interface RefereeAssignmentDetail extends RefereeAssignmentMatch {
  readOnly: boolean; readOnlyReason: string | null; minimumRestMinutes: number;
  canReplace: boolean;
  occupancy: { occupiedFrom: string; occupiedTo: string };
  suggestions: Array<{ position: string; candidates: RefereeCandidateSuggestion[] }>;
}
export interface RefereeAssignmentWorkspace {
  tournamentId: string; readOnly: boolean; readOnlyReason: string | null; configurationRequired: boolean;
  configurationRevision: number; minimumRestMinutes: number; matches: RefereeAssignmentMatch[];
  stats: { total: number; complete: number; missing: number; completionRate: number; conflicts: number; published: number };
  people: Array<{ userId: string; fullName: string }>;
  scheduleContext: { tournamentId: string; drawVersionId: string; diagramVersion: string; fixtures: DemoFixture[];
    entries: Record<string, DemoScheduleEntry>; resources: DemoScheduleResources | null; schedulePublishedAt: string | null;
    tournamentContext: ScheduleSetupTournamentContext; rules: TournamentRules | null } | null;
}
const base = (id: string) => `/tournaments/${encodeURIComponent(id)}/referee-team/assignments`;
export const getRefereeAssignmentWorkspace = (id: string): Promise<RefereeAssignmentWorkspace> => apiFetch(base(id));
export const getRefereeAssignmentDetail = (id: string, matchId: string, signal?: AbortSignal): Promise<RefereeAssignmentDetail> => apiFetch(`${base(id)}/${encodeURIComponent(matchId)}`, { signal });
export const previewRefereeAssignmentPositions = (id: string, matchId: string, positions: RefereePosition[], signal?: AbortSignal): Promise<RefereeAssignmentDetail> => apiFetch(`${base(id)}/${encodeURIComponent(matchId)}/suggestions`, { method: "POST", body: JSON.stringify({ positions }), signal });
export const saveRefereeAssignment = (id: string, matchId: string, input: {
  slots: RefereeDraftSlot[]; expectedRevision: number; configurationRevision: number; scheduleSignature: string; matchPositions?: RefereePosition[];
}): Promise<RefereeAssignmentDetail> => apiFetch(`${base(id)}/${encodeURIComponent(matchId)}`, { method: "PUT", body: JSON.stringify(input) });
export const publishRefereeAssignments = (id: string, requestId: string, matches: RefereeAssignmentMatch[]): Promise<{ publishedMatchIds: string[]; replayed: boolean }> => apiFetch(`${base(id)}/publish`, { method: "POST", body: JSON.stringify({ requestId, matches: matches.map((row) => ({ matchId: row.matchId, expectedRevision: row.revision, configurationRevision: row.configurationRevision, scheduleSignature: row.scheduleSignature })) }) });
export const replacePublishedReferee = (id: string, matchId: string, input: { requestId: string; expectedPublicationRevision: number; scheduleSignature: string; position: string; oldRefereeId: string; newRefereeId: string; reason: string }): Promise<{ replayed: boolean }> => apiFetch(`${base(id)}/${encodeURIComponent(matchId)}/replace`, { method: "POST", body: JSON.stringify(input) });
export const resendRefereeAssignmentEmail = (id: string, matchId: string, requestId: string, expectedPublicationRevision: number) => apiFetch(`${base(id)}/${encodeURIComponent(matchId)}/resend-email`, { method: "POST", body: JSON.stringify({ requestId, expectedPublicationRevision }) });
export interface RefereePublicationVersion { revision: number; action: "PUBLISH" | "REPLACE"; positions: RefereePosition[]; slots: RefereeDraftSlot[]; publishedBy: string; publishedAt: string; reason: string | null; voidedAt: string | null; voidReason: string | null }
export const getRefereePublicationHistory = (id: string, matchId: string): Promise<{ versions: RefereePublicationVersion[] }> => apiFetch(`${base(id)}/${encodeURIComponent(matchId)}/history`);

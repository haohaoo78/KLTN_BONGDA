import type { EffectiveMatchRules, MatchOperationRules, OperationRuleVersion } from "@sfl/shared";
import { apiFetch } from "./client";
const base = (id: string) => `/tournaments/${encodeURIComponent(id)}/regulation-operation-rules`;
export const getOperationRuleVersions = (id: string) => apiFetch<{ versions: OperationRuleVersion[] }>(base(id));
export const saveOperationRuleDraft = (id: string, input: { baseRegulationVersion: number; expectedRevision: number; rules: MatchOperationRules; reason: string }) =>
  apiFetch<{ version: OperationRuleVersion }>(base(id), { method: "POST", body: JSON.stringify(input) });
export const publishOperationRules = (id: string, revision: number) =>
  apiFetch<{ version: OperationRuleVersion }>(`${base(id)}/${revision}/publish`, { method: "POST", body: JSON.stringify({ expectedRevision: revision }) });
export type RuleBindingCandidate = { matchId: string; stage: string; drawVersionId: string; baseRegulationVersion: number | null; bindingRevision: number; supplementId: string | null; eligible: boolean; needsBaseVersionConfirmation: boolean };
export const getRuleBindingCandidates = (id: string) => apiFetch<{ matches: RuleBindingCandidate[] }>(`/tournaments/${encodeURIComponent(id)}/fixtures/operation-rules`);
export const applyOperationRules = (id: string, supplementId: string, matches: RuleBindingCandidate[], reason: string, confirmLegacyBaseVersion = false) =>
  apiFetch<{ appliedMatchIds: string[]; unchangedCount: number }>(`/tournaments/${encodeURIComponent(id)}/fixtures/operation-rules/apply`, { method: "POST", body: JSON.stringify({ supplementId, reason, confirmLegacyBaseVersion, matches: matches.map(m => ({ matchId: m.matchId, expectedBindingRevision: m.bindingRevision })) }) });
export const getEffectiveMatchRules = (id: string) => apiFetch<{ rules: EffectiveMatchRules }>(`/matches/${encodeURIComponent(id)}/operation-rules`);

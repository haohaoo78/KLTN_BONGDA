import type { PoolClient } from "pg";
import { resolveMatchOperationRules, validateMatchOperationRules, type EffectiveMatchRules, type MatchRulesBase, type OperationRuleVersion, type RuleOperation } from "@sfl/shared";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import { config } from "../config";
import { publishMatchUpdate } from "../realtime/matchRealtime";
import type { MatchScoreInput } from "./matchResultValidation";

type Source = { base: MatchRulesBase; supplement: OperationRuleVersion | null };
type RuleMatch = { id: string; tournament_id: string; draw_version_id: string | null; stage: "GROUP" | "KNOCKOUT" | null; regulation_version: number | null; publication_status: string | null; status: string };
type Query = Pick<PoolClient, "query">;
async function ruleMatch(matchId: string, query: Query): Promise<RuleMatch> {
  const r = await query.query<RuleMatch>(`SELECT m.id,m.tournament_id,m.draw_version_id,m.stage,m.status,g.regulation_version,g.publication_status
    FROM matches m LEFT JOIN match_fixture_generations g ON g.draw_version_id=m.draw_version_id AND g.stage=m.stage WHERE m.id=$1`, [matchId]);
  if (!r.rowCount) throw new AppError(404, "Không tìm thấy trận.", "MATCH_NOT_FOUND"); return r.rows[0];
}
async function sourceFor(match: Pick<RuleMatch, "tournament_id" | "draw_version_id" | "regulation_version">, supplementId: string | null): Promise<Source> {
  if (!match.draw_version_id) {
    if (supplementId) throw new AppError(409, "Trận chưa liên kết sơ đồ chính thức.", "MATCH_RULES_SOURCE_MISSING");
    return { base: { regulationVersion: null, footballFormat: null, competitionFormat: null, rankingCriteria: [], rules: null }, supplement: null };
  }
  const url = new URL(`/internal/tournaments/${match.tournament_id}/match-rules-source`, config.tournamentServiceUrl);
  url.searchParams.set("drawVersionId", match.draw_version_id); if (supplementId) url.searchParams.set("supplementId", supplementId);
  let response: Response;
  try { response = await fetch(url, { headers: { "x-gateway-internal-key": config.internalApiKey }, signal: AbortSignal.timeout(5000) }); }
  catch { throw new AppError(503, "Không thể xác minh nguồn điều lệ của trận. Hãy thử lại.", "MATCH_RULES_UNAVAILABLE"); }
  const body = await response.json() as Source & { error?: { message?: string; code?: string } };
  if (!response.ok) throw new AppError(response.status === 409 ? 409 : 502, body.error?.message ?? "Không thể đọc điều lệ chính thức của trận.", body.error?.code ?? "MATCH_RULES_UNAVAILABLE");
  if (!supplementId && body.base?.source === "MISSING_DRAW_SNAPSHOT") return { base: body.base, supplement: null };
  if (!body.base?.regulationVersion || (match.regulation_version != null && body.base.regulationVersion !== match.regulation_version)) throw new AppError(409, "Phiên bản điều lệ không khớp sơ đồ đã công bố.", "RULES_BASE_VERSION_MISMATCH");
  return { base: body.base, supplement: body.supplement };
}
export async function getEffectiveMatchRules(matchId: string, query: Query = getPool()): Promise<EffectiveMatchRules> {
  const match = await ruleMatch(matchId, query);
  const bound = await query.query("SELECT revision,source FROM match_operation_rule_bindings WHERE match_id=$1 ORDER BY revision DESC LIMIT 1", [matchId]);
  const source: Source = bound.rowCount ? bound.rows[0].source : await sourceFor(match, null);
  return resolveMatchOperationRules(source.base, source.supplement, match.stage, bound.rows[0]?.revision ?? 0);
}
export function assertRuleOperation(rules: EffectiveMatchRules, operation: RuleOperation): void {
  const missing = rules.missing[operation];
  if (missing.length) throw new AppError(409, `Chưa đủ quy tắc cho thao tác này: ${missing.join("; ")}. BTC cần bổ sung điều lệ có phiên bản.`, "MATCH_RULES_UNDEFINED", { operation, missing, baseRegulationVersion: rules.base.regulationVersion, supplementId: rules.supplement?.id ?? null });
}
export function assertClockRuleAction(rules: EffectiveMatchRules, action: string, phase?: string): void {
  if (["START_MATCH", "START_EXTRA_TIME", "START_PENALTIES"].includes(action)) assertRuleOperation(rules, "CLOCK");
  if (action === "START_EXTRA_TIME" && rules.decisionMethod !== "EXTRA_TIME_THEN_PENALTIES") throw new AppError(409, "Giai đoạn này không áp dụng hiệp phụ.", "EXTRA_TIME_NOT_ALLOWED");
  if (action === "START_PENALTIES") {
    assertRuleOperation(rules, "SHOOTOUT");
    if (rules.decisionMethod === "ALLOW_DRAW") throw new AppError(409, "Giai đoạn này cho phép hòa, không áp dụng luân lưu.", "SHOOTOUT_NOT_ALLOWED");
    if(!['PENALTIES_ONLY','EXTRA_TIME_THEN_PENALTIES'].includes(rules.decisionMethod??''))throw new AppError(409,'Phương thức phân định chưa được hỗ trợ.','SHOOTOUT_NOT_ALLOWED');
    if(rules.decisionMethod==='PENALTIES_ONLY'&&phase!=='REGULATION_COMPLETE')throw new AppError(409,'Luân lưu trực tiếp chỉ sau hai hiệp chính.','INVALID_CLOCK_TRANSITION');
    if (rules.decisionMethod === "EXTRA_TIME_THEN_PENALTIES" && phase !== "EXTRA_TIME_COMPLETE") throw new AppError(409, "Phải hoàn tất hiệp phụ theo điều lệ trước khi đá luân lưu.", "EXTRA_TIME_REQUIRED");
  }
}
export function assertResultRulePolicy(rules: EffectiveMatchRules, score: MatchScoreInput, final = false): void {
  assertRuleOperation(rules, "FINALIZE");
  const hasExtra = score.homeExtraTimeScore != null || score.awayExtraTimeScore != null;
  const hasPenalties = score.homePenaltyScore != null || score.awayPenaltyScore != null;
  if (hasExtra && rules.decisionMethod !== "EXTRA_TIME_THEN_PENALTIES") throw new AppError(409, "Điều lệ giai đoạn này không có hiệp phụ.", "EXTRA_TIME_NOT_ALLOWED");
  if (hasPenalties && rules.decisionMethod === "ALLOW_DRAW") throw new AppError(409, "Vòng này cho phép hòa, không cộng luân lưu vào kết quả.", "SHOOTOUT_NOT_ALLOWED");
  if (hasPenalties) {
    assertRuleOperation(rules,"SHOOTOUT");
    if (rules.decisionMethod === "EXTRA_TIME_THEN_PENALTIES" && !hasExtra) throw new AppError(409, "Thiếu tỷ số hiệp phụ theo điều lệ.", "EXTRA_TIME_REQUIRED");
  }
  if (final && rules.decisionMethod !== "ALLOW_DRAW" && score.homeScore + (score.homeExtraTimeScore ?? 0) === score.awayScore + (score.awayExtraTimeScore ?? 0) && !hasPenalties) throw new AppError(409, "Trận cần phân định đội thắng theo điều lệ trước khi xác nhận.", "MATCH_WINNER_REQUIRED");
}
export async function listRuleBindingCandidates(tournamentId: string) {
  const result = await getPool().query(`SELECT m.id,m.stage,m.draw_version_id,g.regulation_version,
    COALESCE(b.revision,0)::int AS binding_revision,b.supplement_id,
    (g.publication_status='PUBLISHED' AND m.status IN ('UNSCHEDULED','SCHEDULED','POSTPONED')
      AND NOT EXISTS(SELECT 1 FROM lineups l WHERE l.match_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM match_events e WHERE e.match_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM match_results r WHERE r.match_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM match_reports r WHERE r.match_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM match_clock_states c WHERE c.match_id=m.id AND (c.phase<>'NOT_STARTED' OR c.version<>0))) AS eligible
    FROM matches m LEFT JOIN match_fixture_generations g ON g.draw_version_id=m.draw_version_id AND g.stage=m.stage
    LEFT JOIN LATERAL (SELECT revision,supplement_id FROM match_operation_rule_bindings WHERE match_id=m.id ORDER BY revision DESC LIMIT 1) b ON true
    WHERE m.tournament_id=$1 ORDER BY m.id`, [tournamentId]);
  const sources = new Map<string, Promise<Source>>();
  return Promise.all(result.rows.map(async r => {
    const key = r.draw_version_id ?? "legacy-without-draw";
    if (!sources.has(key)) sources.set(key, sourceFor({ tournament_id: tournamentId, draw_version_id: r.draw_version_id, regulation_version: r.regulation_version }, null));
    const source = await sources.get(key)!;
    return { matchId: r.id, stage: r.stage, drawVersionId: r.draw_version_id, baseRegulationVersion: r.regulation_version,
      bindingRevision: r.binding_revision, supplementId: r.supplement_id ?? null, eligible: r.eligible === true,
      needsBaseVersionConfirmation: r.regulation_version == null || source.base.source === "MISSING_DRAW_SNAPSHOT" };
  }));
}
export async function applyOperationRuleVersion(input: { tournamentId: string; supplementId: string; matches: Array<{ matchId: string; expectedBindingRevision: number }>; reason: string; actorId: string; confirmLegacyBaseVersion?: boolean }) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const requested = [...input.matches].sort((a,b) => a.matchId.localeCompare(b.matchId));
    const sources = new Map<string, Source>(), applied: string[] = [];
    for (const item of requested) {
      await client.query("SELECT id FROM matches WHERE id=$1 FOR UPDATE", [item.matchId]);
      const match = await ruleMatch(item.matchId, client);
      if (match.tournament_id !== input.tournamentId) throw new AppError(403, "Trận không thuộc giải đang quản lý.", "MATCH_TOURNAMENT_MISMATCH");
      if (match.publication_status !== "PUBLISHED") throw new AppError(409, "Chỉ áp dụng quy tắc tác nghiệp cho sơ đồ đã công bố.", "PUBLISHED_FIXTURES_REQUIRED");
      const used = await client.query(`SELECT
        EXISTS(SELECT 1 FROM lineups WHERE match_id=$1) OR EXISTS(SELECT 1 FROM match_events WHERE match_id=$1) OR
        EXISTS(SELECT 1 FROM match_results WHERE match_id=$1) OR EXISTS(SELECT 1 FROM match_reports WHERE match_id=$1) OR
        EXISTS(SELECT 1 FROM match_clock_states WHERE match_id=$1 AND (phase<>'NOT_STARTED' OR version<>0)) AS used`, [match.id]);
      if (!["UNSCHEDULED", "SCHEDULED", "POSTPONED"].includes(match.status) || used.rows[0].used) throw new AppError(409, "Trận đã có dữ liệu tác nghiệp hoặc đã xác nhận đội hình; không thay quy tắc qua luồng thông thường.", "MATCH_RULES_LOCKED", { matchId: match.id });
      const current = await client.query("SELECT revision,supplement_id FROM match_operation_rule_bindings WHERE match_id=$1 ORDER BY revision DESC LIMIT 1", [match.id]);
      if ((current.rows[0]?.revision ?? 0) !== item.expectedBindingRevision) throw new AppError(409, "Quy tắc của trận vừa thay đổi. Hãy tải lại.", "MATCH_RULES_VERSION_CONFLICT", { matchId: match.id });
      if (current.rows[0]?.supplement_id === input.supplementId) continue;
      const key = match.draw_version_id ?? match.id;
      const source = sources.get(key) ?? await sourceFor(match, input.supplementId); sources.set(key, source);
      if (!source.supplement) throw new AppError(409, "Cần bản bổ sung đã công bố.", "PUBLISHED_RULES_REQUIRED");
      const checked = validateMatchOperationRules(source.supplement.rules, source.base.footballFormat!);
      if (checked.errors.length) throw new AppError(409, checked.errors.join(" "), "INVALID_OPERATION_RULES");
      if (match.regulation_version != null && match.regulation_version !== source.base.regulationVersion) throw new AppError(409, "Điều lệ không khớp trận.", "RULES_BASE_VERSION_MISMATCH");
      if (source.base.source === "VERSIONED_SUPPLEMENT_BASE" && input.confirmLegacyBaseVersion !== true) throw new AppError(409, "Trận cũ chưa có phiên bản điều lệ liên kết. BTC cần xác nhận rõ bản điều lệ gốc trong bản bổ sung trước khi áp dụng.", "MATCH_RULES_BASE_CONFIRMATION_REQUIRED");
      await client.query(`INSERT INTO match_operation_rule_bindings(match_id,revision,supplement_id,source,reason,applied_by)
        VALUES($1,$2,$3,$4::jsonb,$5,$6)`, [match.id,item.expectedBindingRevision+1,input.supplementId,JSON.stringify(source),input.reason,input.actorId]);
      await publishMatchUpdate(client, match.id, "match.rules.changed"); applied.push(match.id);
    }
    await client.query("COMMIT"); return { appliedMatchIds: applied, unchangedCount: requested.length - applied.length };
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

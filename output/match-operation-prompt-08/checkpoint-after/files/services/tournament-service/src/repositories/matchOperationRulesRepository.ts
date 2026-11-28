import type { MatchRulesBase, OperationRuleVersion } from "@sfl/shared";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";

function map(row: Record<string, any>): OperationRuleVersion {
  return { id: row.id, tournamentId: row.tournament_id, baseRegulationVersion: row.base_regulation_version,
    revision: row.revision, status: row.status, rules: row.rules, reason: row.reason,
    createdBy: row.created_by, createdAt: row.created_at.toISOString(), publishedBy: row.published_by,
    publishedAt: row.published_at?.toISOString() ?? null, baseSnapshot: row.base_snapshot ?? null };
}
export async function listOperationRuleVersions(tournamentId: string): Promise<OperationRuleVersion[]> {
  const result = await getPool().query("SELECT * FROM regulation_operation_rules WHERE tournament_id=$1 ORDER BY revision DESC", [tournamentId]);
  return result.rows.map(map);
}
export async function createOperationRuleVersion(input: { tournamentId: string; baseRegulationVersion: number; expectedRevision: number; rules: OperationRuleVersion["rules"]; baseSnapshot: MatchRulesBase; reason: string; actorId: string }): Promise<OperationRuleVersion> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const t = await client.query("SELECT status FROM tournaments WHERE id=$1 FOR UPDATE", [input.tournamentId]);
    if (!t.rowCount) throw new AppError(404, "Không tìm thấy giải.", "TOURNAMENT_NOT_FOUND");
    if (["COMPLETED", "CANCELLED"].includes(t.rows[0].status)) throw new AppError(409, "Không bổ sung điều lệ qua luồng thông thường cho giải đã kết thúc/hủy.", "TOURNAMENT_RULES_LOCKED");
    const current = await client.query("SELECT COALESCE(MAX(revision),0)::int AS revision FROM regulation_operation_rules WHERE tournament_id=$1", [input.tournamentId]);
    if (current.rows[0].revision !== input.expectedRevision) throw new AppError(409, "Quy tắc đã có phiên bản mới. Hãy tải lại trước khi lưu.", "RULES_VERSION_CONFLICT");
    const base = await client.query("SELECT 1 FROM regulation_versions WHERE tournament_id=$1 AND version=$2", [input.tournamentId, input.baseRegulationVersion]);
    if (!base.rowCount) throw new AppError(409, "Không tìm thấy phiên bản điều lệ gốc.", "REGULATION_VERSION_REQUIRED");
    const result = await client.query(`INSERT INTO regulation_operation_rules
      (tournament_id,base_regulation_version,revision,status,rules,reason,created_by,base_snapshot)
      VALUES ($1,$2,$3,'DRAFT',$4::jsonb,$5,$6,$7::jsonb) RETURNING *`,
      [input.tournamentId, input.baseRegulationVersion, input.expectedRevision + 1, JSON.stringify(input.rules), input.reason, input.actorId, JSON.stringify(input.baseSnapshot)]);
    await client.query("COMMIT"); return map(result.rows[0]);
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function publishOperationRuleVersion(tournamentId: string, revision: number, expectedRevision: number, actorId: string): Promise<OperationRuleVersion> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tournament = await client.query("SELECT status FROM tournaments WHERE id=$1 FOR UPDATE", [tournamentId]);
    if (!tournament.rowCount || ["COMPLETED", "CANCELLED"].includes(tournament.rows[0].status)) throw new AppError(409, "Trạng thái giải không cho phép công bố bổ sung điều lệ.", "TOURNAMENT_RULES_LOCKED");
    const current = await client.query("SELECT * FROM regulation_operation_rules WHERE tournament_id=$1 ORDER BY revision DESC LIMIT 1 FOR UPDATE", [tournamentId]);
    if (!current.rowCount || current.rows[0].revision !== expectedRevision || revision !== expectedRevision) throw new AppError(409, "Chỉ công bố bản nháp mới nhất đã xem.", "RULES_VERSION_CONFLICT");
    if (current.rows[0].status === "PUBLISHED") { await client.query("COMMIT"); return map(current.rows[0]); }
    const r = current.rows[0].rules;
    if (!r.lawCode || !r.sport || !r.edition || !r.source) throw new AppError(409, "Cần xác định bộ luật, loại hình, phiên bản và nguồn trước khi công bố. Các quy tắc khác còn thiếu sẽ được báo theo từng nghiệp vụ.", "LAW_REFERENCE_REQUIRED");
    const result = await client.query("UPDATE regulation_operation_rules SET status='PUBLISHED',published_by=$3,published_at=NOW() WHERE tournament_id=$1 AND revision=$2 RETURNING *", [tournamentId, revision, actorId]);
    await client.query("COMMIT"); return map(result.rows[0]);
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}

/** Exact draw revision, including archived published draws. Never fall back to today's rules. */
export async function readMatchRulesSource(tournamentId: string, drawVersionId: string, supplementId: string | null): Promise<{ base: MatchRulesBase; supplement: OperationRuleVersion | null }> {
  const result = await getPool().query(`SELECT d.config,t.football_format FROM tournament_draw_versions d
    JOIN tournaments t ON t.id=d.tournament_id WHERE d.tournament_id=$1 AND d.id=$2 AND d.published_at IS NOT NULL`, [tournamentId, drawVersionId]);
  if (!result.rowCount) throw new AppError(409, "Không tìm thấy kết quả bốc thăm đã công bố của trận.", "MATCH_RULES_SOURCE_MISSING");
  const snapshot = result.rows[0].config?.fixtureRegulationSnapshot;
  const hasSnapshot = Boolean(snapshot?.regulationVersion && snapshot.rules);
  let base: MatchRulesBase = { regulationVersion: hasSnapshot ? snapshot.regulationVersion : null, footballFormat: result.rows[0].football_format,
    competitionFormat: snapshot?.competitionFormat ?? null, rankingCriteria: snapshot?.rankingCriteria ?? [], rules: hasSnapshot ? snapshot.rules : null,
    source: hasSnapshot ? "DRAW_SNAPSHOT" : "MISSING_DRAW_SNAPSHOT" };
  let supplement: OperationRuleVersion | null = null;
  if (supplementId) {
    const v = await getPool().query("SELECT * FROM regulation_operation_rules WHERE tournament_id=$1 AND id=$2 AND status='PUBLISHED'", [tournamentId, supplementId]);
    if (!v.rowCount) throw new AppError(409, "Bản bổ sung chưa công bố hoặc không thuộc phiên bản điều lệ của trận.", "RULES_BASE_VERSION_MISMATCH");
    supplement = map(v.rows[0]);
    if (hasSnapshot && supplement.baseRegulationVersion !== base.regulationVersion) throw new AppError(409, "Bản bổ sung không thuộc điều lệ đã gắn với trận.", "RULES_BASE_VERSION_MISMATCH");
    if (!hasSnapshot) {
      const captured = supplement.baseSnapshot;
      if (!captured?.rules || captured.regulationVersion !== supplement.baseRegulationVersion || captured.footballFormat !== base.footballFormat) throw new AppError(409, "Trận cũ chưa có căn cứ phiên bản. Cần BTC soạn và công bố bản bổ sung mới có bản điều lệ gốc đính kèm.", "MATCH_RULES_SOURCE_MISSING");
      base = { ...captured, source: "VERSIONED_SUPPLEMENT_BASE" };
    }
  }
  return { base, supplement };
}

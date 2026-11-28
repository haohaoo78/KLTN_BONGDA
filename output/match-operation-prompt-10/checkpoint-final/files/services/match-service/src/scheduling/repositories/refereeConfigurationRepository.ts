import type { PoolClient } from "pg";
import { getPool } from "../lib/db";
import { getPool as getMatchPool } from "../../lib/db";
import { AppError } from "../../lib/errors";
import { crewHasCapability } from "../crewValidation";
import { REFEREE_CAPABILITIES, type RefereeConfiguration, type RefereeConfigurationRecord, type RefereeFixtureScope } from "../models/refereeConfiguration";
import type { ScheduleRefereeAssignmentInput } from "../models/scheduling";
import { crewConfigurationIssues, effectiveRefereePositions } from "../services/refereeConfigurationValidation";

export async function lockRefereeConfiguration(client: PoolClient, tournamentId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`referee-configuration:${tournamentId}`]);
}

export async function findRefereeConfiguration(tournamentId: string, client?: PoolClient): Promise<RefereeConfigurationRecord | null> {
  const result = await (client ?? getPool()).query(`SELECT configuration,revision,updated_by,updated_at FROM tournament_referee_configurations WHERE tournament_id=$1`, [tournamentId]);
  const row = result.rows[0];
  return row ? { configuration: row.configuration, revision: row.revision, updatedBy: row.updated_by, updatedAt: new Date(row.updated_at).toISOString() } : null;
}

export async function refereeFixtureScopes(tournamentId: string): Promise<RefereeFixtureScope[]> {
  const result = await getMatchPool().query(`SELECT id,stage,round_number AS "roundNumber" FROM matches WHERE tournament_id=$1`, [tournamentId]);
  return result.rows;
}

export async function configuredPositionsForMatch(tournamentId: string, matchId: string, client?: PoolClient) {
  const saved = await findRefereeConfiguration(tournamentId, client);
  if (!saved) return null;
  const scope = (await refereeFixtureScopes(tournamentId)).find((fixture) => fixture.id === matchId);
  if (!scope) throw new AppError(409, "Không xác định được phạm vi trận để áp dụng cấu hình trọng tài.", "REFEREE_CONFIG_MATCH_MISSING");
  return effectiveRefereePositions(saved.configuration, scope).positions;
}

export async function assertConfiguredCrew(client: PoolClient, tournamentId: string, matchId: string, assignments: ScheduleRefereeAssignmentInput[]): Promise<void> {
  const positions = await configuredPositionsForMatch(tournamentId, matchId, client);
  if (!positions) return;
  const issues = crewConfigurationIssues(positions, assignments);
  if (issues.length) throw new AppError(409, "Phân công không đáp ứng cấu hình trọng tài của trận.", "REFEREE_CONFIG_ASSIGNMENT_CONFLICT", { matchId, issues });
}

export async function saveRefereeConfiguration(tournamentId: string, configuration: RefereeConfiguration, expectedRevision: number, updatedBy: string, assertMutable: () => Promise<void>, transaction?: PoolClient, editingDraftScheduleId?: string) {
  const client = transaction ?? await getPool().connect();
  try {
    if (!transaction) await client.query("BEGIN");
    await lockRefereeConfiguration(client, tournamentId);
    const current = await findRefereeConfiguration(tournamentId, client);
    if ((current?.revision ?? 0) !== expectedRevision) throw new AppError(409, "Cấu hình đã được cập nhật ở phiên khác. Tải lại trước khi lưu.", "REFEREE_CONFIG_REVISION_CONFLICT");
    await assertMutable();
    const scopes = new Map((await refereeFixtureScopes(tournamentId)).map((scope) => [scope.id, scope]));
    const rows = await client.query(`SELECT s.id,s.match_id,s.referee_id,
      COALESCE(jsonb_agg(jsonb_build_object('refereeId',a.referee_id,'position',a.position,'isFinalAuthority',a.is_final_authority)) FILTER (WHERE a.id IS NOT NULL),'[]'::jsonb) AS assignments
      FROM schedules s LEFT JOIN schedule_referee_assignments a ON a.schedule_id=s.id AND a.is_active=TRUE
      WHERE s.tournament_id=$1 AND s.status<>'CANCELLED' GROUP BY s.id HAVING s.referee_id IS NOT NULL OR COUNT(a.id)>0`, [tournamentId]);
    const impacts: Array<{ matchId: string; scheduleId: string; reasons: string[] }> = [];
    for (const row of rows.rows) {
      const scope = scopes.get(row.match_id);
      if (!scope) { impacts.push({ matchId: row.match_id, scheduleId: row.id, reasons: ["Không xác định được cấu trúc trận đã phân công."] }); continue; }
      if (!row.assignments.length) { impacts.push({ matchId: row.match_id, scheduleId: row.id, reasons: ["Phân công cũ chưa có vị trí và quyền đầy đủ; cần kiểm tra lại tổ trọng tài trước khi áp dụng cấu hình."] }); continue; }
      const assignments: ScheduleRefereeAssignmentInput[] = row.assignments.length ? row.assignments : [{ refereeId: row.referee_id, position: "REFEREE", isFinalAuthority: true }];
      const next = effectiveRefereePositions(configuration, scope).positions;
      const before = current ? effectiveRefereePositions(current.configuration, scope).positions : null;
      const reasons = crewConfigurationIssues(next, assignments);
      for (const assignment of assignments) {
        const previous = before?.find((p) => p.code === assignment.position);
        const candidate = next.find((p) => p.code === assignment.position);
        const changed = candidate && REFEREE_CAPABILITIES.some((capability) => {
          const old = before ? previous?.capabilities.includes(capability) === true
            : crewHasCapability(assignment.position, assignment.isFinalAuthority === true, capability);
          return old !== candidate.capabilities.includes(capability);
        });
        if (changed) reasons.push(`Quyền của vị trí ${candidate.label} đã thay đổi so với phân công đang lưu.`);
      }
      if (reasons.length) impacts.push({ matchId: row.match_id, scheduleId: row.id, reasons });
    }
    if (impacts.length) throw new AppError(409, `Cấu hình ảnh hưởng ${impacts.length} trận đã phân công. Cần kiểm tra và cập nhật phân công trước khi đổi cấu hình.`, "REFEREE_CONFIG_ASSIGNMENTS_AFFECTED", { affectedCount: impacts.length, impacts: impacts.slice(0, 50) });
    const drafts = await client.query(`SELECT d.schedule_id,s.match_id,d.positions,a.position
      FROM schedule_referee_drafts d JOIN schedules s ON s.id=d.schedule_id JOIN schedule_referee_draft_slots a ON a.schedule_id=d.schedule_id
      WHERE d.tournament_id=$1 AND s.status<>'CANCELLED' AND ($2::uuid IS NULL OR d.schedule_id<>$2)`, [tournamentId, editingDraftScheduleId ?? null]);
    for (const draft of drafts.rows) {
      const scope = scopes.get(draft.match_id);
      const before = (draft.positions as import("../models/refereeConfiguration").RefereePosition[]).find((position) => position.code === draft.position);
      const next = scope ? effectiveRefereePositions(configuration, scope).positions.find((position) => position.code === draft.position) : null;
      if (!before || !next || REFEREE_CAPABILITIES.some((capability) => before.capabilities.includes(capability) !== next.capabilities.includes(capability))) {
        impacts.push({ matchId: draft.match_id, scheduleId: draft.schedule_id, reasons: ["Vị trí/quyền của trọng tài trong bản nháp thay đổi. Kiểm tra phân công trận trước khi đổi cấu hình."] });
      }
    }
    if (impacts.length) throw new AppError(409, "Cấu hình ảnh hưởng các bản nháp phân công đã lưu.", "REFEREE_CONFIG_ASSIGNMENTS_AFFECTED", { affectedCount: impacts.length, impacts: impacts.slice(0, 50) });
    await client.query(`INSERT INTO tournament_referee_configurations(tournament_id,configuration,revision,updated_by)
      VALUES($1,$2::jsonb,1,$3) ON CONFLICT(tournament_id) DO UPDATE SET configuration=EXCLUDED.configuration,revision=tournament_referee_configurations.revision+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()`, [tournamentId, JSON.stringify(configuration), updatedBy]);
    const result = await findRefereeConfiguration(tournamentId, client);
    if (!transaction) await client.query("COMMIT");
    return result!;
  } catch (error) { if (!transaction) await client.query("ROLLBACK"); throw error; }
  finally { if (!transaction) client.release(); }
}

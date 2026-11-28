import { AppError } from "../lib/errors";
import { getPool } from "../lib/db";
import { config as runtimeConfig } from "../config";
import { getTournament } from "./tournamentService";
import { getDrawManagement } from "./drawWorkflowService";

export type DrawTestConfiguration = {
  format: "ROUND_ROBIN" | "KNOCKOUT" | "GROUP_AND_KNOCKOUT";
  teamIds: string[];
  groupCount: number;
  teamsPerGroup: number[];
  roundRobinLegs: 1 | 2;
  qualifiersPerGroup: number;
  extraQualificationSlots: number;
  knockoutPairing: "GROUP_RANK" | "REDRAW" | "FIXED_CROSSOVER";
  thirdPlaceMatch: boolean;
  seedGroups: Record<string, number>;
  separateSameInstitution: boolean;
  byePolicy: "AUTOMATIC" | "SEEDED_FIRST";
  method: "DIRECT" | "RANDOM" | "MANUAL";
};

function assertDemoEnvironment(): void {
  if (runtimeConfig.nodeEnv !== "development" && runtimeConfig.nodeEnv !== "test") {
    throw new AppError(404, "Draw test configuration is not available", "NOT_FOUND");
  }
}

/**
 * The browser-only draw workspace is a development/test capability, not a
 * property of one seeded account or tournament. Any authorized BTC manager
 * may use it for a roster-locked tournament; ownership is enforced by the
 * route middleware before this service runs. Production never exposes it.
 */
async function assertDrawTestTournament(tournamentId: string): Promise<void> {
  assertDemoEnvironment();
  const tournament = await getTournament(tournamentId);
  if (tournament.status !== "ROSTER_LOCKED") {
    throw new AppError(404, "Draw test configuration is not available", "NOT_FOUND");
  }
}

function makeDefaults(tournament: Awaited<ReturnType<typeof getTournament>>, teamIds: string[]): DrawTestConfiguration {
  const selectedIds = teamIds.slice(0, tournament.maxTeams);
  const format = tournament.competitionFormat;
  const rules = tournament.rules?.competitionConfig;
  const count = rules?.groupCountMode === "FIXED" && rules.groupCount
    ? rules.groupCount
    : Math.max(1, Math.ceil(selectedIds.length / (tournament.rules?.maxTeamsPerGroup ?? 8)));
  const normalizedGroupCount = format === "KNOCKOUT" ? 1 : Math.max(1, Math.min(count, selectedIds.length || 1));
  return {
    format,
    teamIds: selectedIds,
    groupCount: normalizedGroupCount,
    teamsPerGroup: Array.from({ length: normalizedGroupCount }, (_, index) => Math.floor(selectedIds.length / normalizedGroupCount) + (index < selectedIds.length % normalizedGroupCount ? 1 : 0)),
    roundRobinLegs: tournament.rules?.roundRobinLegs ?? 1,
    qualifiersPerGroup: tournament.rules?.advancingTeamsPerGroup ?? 2,
    extraQualificationSlots: 0,
    knockoutPairing: rules?.knockoutPairing ?? "GROUP_RANK",
    thirdPlaceMatch: rules?.thirdPlaceMatch ?? false,
    seedGroups: {},
    separateSameInstitution: rules?.sameInstitutionPolicy === "REQUIRE_SEPARATE",
    byePolicy: rules?.byePolicy ?? "AUTOMATIC",
    method: "RANDOM",
  };
}

export async function getDrawTestConfiguration(tournamentId: string) {
  try {
    await assertDrawTestTournament(tournamentId);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") return { enabled: false as const, config: null, defaults: null };
    throw error;
  }
  const [tournament, management] = await Promise.all([getTournament(tournamentId), getDrawManagement(tournamentId)]);
  const teamIds = management.eligibleTeams.map((team) => team.teamId);
  if (teamIds.length < 2) return { enabled: false as const, config: null, defaults: null };
  const defaults = makeDefaults(tournament, teamIds);
  return { enabled: true as const, config: null, defaults };
}

function parseConfiguration(value: unknown): DrawTestConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(400, "Cấu hình kiểm thử không hợp lệ", "VALIDATION_ERROR");
  }
  const input = value as Partial<DrawTestConfiguration>;
  if (!["ROUND_ROBIN", "KNOCKOUT", "GROUP_AND_KNOCKOUT"].includes(input.format ?? "")) throw new AppError(400, "Thể thức không hợp lệ", "VALIDATION_ERROR");
  if (!["DIRECT", "RANDOM", "MANUAL"].includes(input.method ?? "")) throw new AppError(400, "Phương thức bốc thăm không hợp lệ", "VALIDATION_ERROR");
  if (!Array.isArray(input.teamIds) || input.teamIds.length < 2 || input.teamIds.some((id) => typeof id !== "string")) throw new AppError(400, "Cần chọn ít nhất 2 đội", "VALIDATION_ERROR");
  if (new Set(input.teamIds).size !== input.teamIds.length) throw new AppError(400, "Danh sách đội có ID bị trùng", "VALIDATION_ERROR");
  if (!Number.isInteger(input.groupCount) || (input.groupCount ?? 0) < 1 || (input.groupCount ?? 0) > input.teamIds.length) throw new AppError(400, "Số bảng không hợp lệ", "VALIDATION_ERROR");
  if (!Array.isArray(input.teamsPerGroup) || input.teamsPerGroup.some((size) => !Number.isInteger(size) || size < 0) || input.teamsPerGroup.reduce((sum, size) => sum + size, 0) !== input.teamIds.length) throw new AppError(400, "Số đội mỗi bảng phải khớp tổng số đội", "VALIDATION_ERROR");
  if (input.roundRobinLegs !== 1 && input.roundRobinLegs !== 2) throw new AppError(400, "Số lượt vòng bảng phải là 1 hoặc 2", "VALIDATION_ERROR");
  if (!Number.isInteger(input.qualifiersPerGroup) || (input.qualifiersPerGroup ?? -1) < 0 || !Number.isInteger(input.extraQualificationSlots) || (input.extraQualificationSlots ?? -1) < 0) throw new AppError(400, "Suất đi tiếp không hợp lệ", "VALIDATION_ERROR");
  if (!["GROUP_RANK", "REDRAW", "FIXED_CROSSOVER"].includes(input.knockoutPairing ?? "")) throw new AppError(400, "Quy tắc ghép cặp không hợp lệ", "VALIDATION_ERROR");
  if (!["AUTOMATIC", "SEEDED_FIRST"].includes(input.byePolicy ?? "")) throw new AppError(400, "Quy tắc BYE không hợp lệ", "VALIDATION_ERROR");
  if (typeof input.thirdPlaceMatch !== "boolean" || typeof input.separateSameInstitution !== "boolean") throw new AppError(400, "Thiếu cấu hình ràng buộc", "VALIDATION_ERROR");
  const seedGroups = input.seedGroups && typeof input.seedGroups === "object" && !Array.isArray(input.seedGroups) ? input.seedGroups : {};
  for (const [teamId, pot] of Object.entries(seedGroups)) if (!input.teamIds.includes(teamId) || !Number.isInteger(pot) || pot < 1) throw new AppError(400, "Nhóm hạt giống không hợp lệ", "VALIDATION_ERROR");
  return {
    format: input.format as DrawTestConfiguration["format"], teamIds: input.teamIds,
    groupCount: input.groupCount!, teamsPerGroup: input.teamsPerGroup!, roundRobinLegs: input.roundRobinLegs,
    qualifiersPerGroup: input.qualifiersPerGroup!, extraQualificationSlots: input.extraQualificationSlots!,
    knockoutPairing: input.knockoutPairing as DrawTestConfiguration["knockoutPairing"],
    thirdPlaceMatch: input.thirdPlaceMatch, seedGroups: seedGroups as Record<string, number>,
    separateSameInstitution: input.separateSameInstitution, byePolicy: input.byePolicy as DrawTestConfiguration["byePolicy"],
    method: input.method as DrawTestConfiguration["method"],
  };
}

export async function saveDrawTestConfiguration(tournamentId: string, body: unknown, userId: string) {
  await assertDrawTestTournament(tournamentId);
  const next = parseConfiguration(body);
  const management = await getDrawManagement(tournamentId);
  const eligible = new Set(management.eligibleTeams.map((team) => team.teamId));
  if (next.teamIds.some((teamId) => !eligible.has(teamId))) throw new AppError(409, "Chỉ được chọn đội đã chốt và đủ điều kiện trong dữ liệu giải demo", "DRAW_TEST_TEAM_NOT_ELIGIBLE");
  if (next.format === "KNOCKOUT" && next.groupCount !== 1) throw new AppError(400, "Loại trực tiếp dùng một nhánh, không chia bảng", "VALIDATION_ERROR");
  if (next.format !== "KNOCKOUT" && next.teamsPerGroup.length !== next.groupCount) throw new AppError(400, "Số nhóm đội phải bằng số bảng", "VALIDATION_ERROR");
  if (next.format === "GROUP_AND_KNOCKOUT" && next.qualifiersPerGroup === 0 && next.extraQualificationSlots === 0) throw new AppError(400, "Cần có ít nhất một suất vào vòng loại trực tiếp", "VALIDATION_ERROR");
  if (next.qualifiersPerGroup * next.groupCount + next.extraQualificationSlots > next.teamIds.length) throw new AppError(400, "Tổng số suất đi tiếp vượt số đội đã chọn", "VALIDATION_ERROR");
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM tournaments WHERE id=$1 AND status='ROSTER_LOCKED' FOR UPDATE", [tournamentId]);
    const lockedHistory = await client.query("SELECT 1 FROM tournament_draw_versions WHERE tournament_id=$1 AND status<>'DRAFT' LIMIT 1", [tournamentId]);
    if (lockedHistory.rowCount) throw new AppError(409, "Không thể thay cấu hình demo sau khi bốc thăm đã được xác nhận hoặc công bố", "DRAW_TEST_CONFIG_LOCKED");
    await client.query(
      `INSERT INTO tournament_draw_test_configs(tournament_id,config,updated_by,updated_at)
       VALUES($1,$2::jsonb,$3,NOW()) ON CONFLICT(tournament_id) DO UPDATE SET config=EXCLUDED.config,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [tournamentId, JSON.stringify(next), userId],
    );
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return { config: next };
}

export async function resetDrawTestConfiguration(tournamentId: string) {
  await assertDrawTestTournament(tournamentId);
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM tournaments WHERE id=$1 AND status='ROSTER_LOCKED' FOR UPDATE", [tournamentId]);
    const lockedHistory = await client.query("SELECT 1 FROM tournament_draw_versions WHERE tournament_id=$1 AND status<>'DRAFT' LIMIT 1", [tournamentId]);
    const activeLive = await client.query("SELECT 1 FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('LIVE','PAUSED','COMPLETED') LIMIT 1", [tournamentId]);
    if (lockedHistory.rowCount || activeLive.rowCount) throw new AppError(409, "Hoàn tất hoặc hủy phiên đang hoạt động trước khi reset. Bản chia đã xác nhận/công bố không bị reset", "DRAW_TEST_DATA_IN_USE");
    await client.query("DELETE FROM tournament_draw_versions WHERE tournament_id=$1 AND status='DRAFT'", [tournamentId]);
    await client.query("DELETE FROM tournament_live_draw_sessions WHERE tournament_id=$1 AND status IN ('CANCELLED','FINALIZED')", [tournamentId]);
    await client.query("DELETE FROM tournament_draw_test_configs WHERE tournament_id=$1", [tournamentId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return { reset: true };
}

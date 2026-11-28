import { AppError } from "../../lib/errors";
import { REFEREE_CAPABILITIES, type RefereeConfiguration, type RefereePosition, type RefereeFixtureScope } from "../models/refereeConfiguration";
import type { ScheduleRefereeAssignmentInput } from "../models/scheduling";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const invalid = (message: string): never => { throw new AppError(400, message, "REFEREE_CONFIG_INVALID"); };

export function parseRefereePositions(value: unknown): RefereePosition[] {
  // Resource bound, not a four-person crew limitation. Custom positions are first-class.
  if (!Array.isArray(value) || !value.length || value.length > 64) return invalid("Cấu hình cần từ 1 đến 64 vị trí trọng tài.");
  const positions = value.map((row): RefereePosition => {
    if (!object(row) || Object.keys(row).some((key) => !["code", "label", "required", "capabilities"].includes(key))
      || typeof row.code !== "string" || !/^[A-Z][A-Z0-9_]{1,59}$/.test(row.code)
      || typeof row.label !== "string" || !row.label.trim() || row.label.trim().length > 120 || typeof row.required !== "boolean"
      || !Array.isArray(row.capabilities) || row.capabilities.some((cap) => !REFEREE_CAPABILITIES.includes(cap))
      || new Set(row.capabilities).size !== row.capabilities.length) return invalid("Tên, mã vị trí hoặc quyền nghiệp vụ không hợp lệ.");
    return { code: row.code, label: row.label.trim(), required: row.required, capabilities: [...row.capabilities].sort() };
  });
  if (new Set(positions.map((p) => p.code)).size !== positions.length) return invalid("Mỗi mã vị trí chỉ xuất hiện một lần trong cấu hình.");
  const final = positions.filter((p) => p.capabilities.includes("FINALIZE"));
  if (final.length !== 1 || !final[0].required) return invalid("Chọn đúng một vị trí bắt buộc được xác nhận kết quả cuối cùng.");
  return positions;
}

export function parseRefereeConfiguration(value: unknown): { configuration: RefereeConfiguration; expectedRevision: number } {
  if (!object(value) || Object.keys(value).some((key) => !["configuration", "expectedRevision"].includes(key))
    || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0 || !object(value.configuration)) return invalid("Cấu hình hoặc phiên bản lưu không hợp lệ.");
  const source = value.configuration;
  if (Object.keys(source).some((key) => !["defaultPositions", "overrides", "minimumRestMinutes"].includes(key)) || !Array.isArray(source.overrides) || source.overrides.length > 512
    || source.minimumRestMinutes !== undefined && (!Number.isInteger(source.minimumRestMinutes) || (source.minimumRestMinutes as number) < 0 || (source.minimumRestMinutes as number) > 10080)) return invalid("Danh sách ngoại lệ hoặc thời gian nghỉ trọng tài không hợp lệ.");
  const configuration: RefereeConfiguration = { defaultPositions: parseRefereePositions(source.defaultPositions), overrides: source.overrides.map((row) => {
    if (!object(row) || Object.keys(row).some((key) => !["id", "scope", "stage", "roundNumber", "matchId", "positions"].includes(key)) || !uuid(row.id)) return invalid("Mã ngoại lệ không hợp lệ.");
    const positions = parseRefereePositions(row.positions);
    if (row.scope === "MATCH" && uuid(row.matchId) && row.stage === undefined && row.roundNumber === undefined) return { id: row.id, scope: "MATCH", matchId: row.matchId, positions };
    if (["STAGE", "ROUND"].includes(String(row.scope)) && ["GROUP", "KNOCKOUT"].includes(String(row.stage)) && row.matchId === undefined) {
      if (row.scope === "STAGE" && row.roundNumber === undefined) return { id: row.id, scope: "STAGE", stage: row.stage as "GROUP" | "KNOCKOUT", positions };
      if (row.scope === "ROUND" && Number.isInteger(row.roundNumber) && (row.roundNumber as number) > 0 && (row.roundNumber as number) <= 1000) return { id: row.id, scope: "ROUND", stage: row.stage as "GROUP" | "KNOCKOUT", roundNumber: row.roundNumber as number, positions };
    }
    return invalid("Chọn đúng giai đoạn, vòng hoặc trận cho cấu hình ngoại lệ.");
  }) };
  if (source.minimumRestMinutes !== undefined) configuration.minimumRestMinutes = source.minimumRestMinutes as number;
  const keys = configuration.overrides.map((row) => `${row.scope}:${row.stage ?? ""}:${row.roundNumber ?? ""}:${row.matchId ?? ""}`);
  if (new Set(keys).size !== keys.length || new Set(configuration.overrides.map((r) => r.id)).size !== keys.length) return invalid("Không được khai báo hai ngoại lệ cho cùng phạm vi.");
  return { configuration, expectedRevision: value.expectedRevision as number };
}

export function validateRefereeScopes(configuration: RefereeConfiguration, fixtures: RefereeFixtureScope[]): void {
  for (const override of configuration.overrides) {
    if (!fixtures.some((fixture) => override.scope === "MATCH" ? fixture.id === override.matchId
      : fixture.stage === override.stage && (override.scope === "STAGE" || fixture.roundNumber === override.roundNumber))) {
      throw new AppError(400, "Ngoại lệ không thuộc giai đoạn, vòng hoặc trận chính thức của giải.", "REFEREE_CONFIG_SCOPE_INVALID", { overrideId: override.id });
    }
  }
}

export function effectiveRefereePositions(configuration: RefereeConfiguration, fixture: RefereeFixtureScope) {
  const override = configuration.overrides.find((row) => row.scope === "MATCH" && row.matchId === fixture.id)
    ?? configuration.overrides.find((row) => row.scope === "ROUND" && row.stage === fixture.stage && row.roundNumber === fixture.roundNumber)
    ?? configuration.overrides.find((row) => row.scope === "STAGE" && row.stage === fixture.stage);
  return { positions: override?.positions ?? configuration.defaultPositions, source: override?.scope ?? "TOURNAMENT", overrideId: override?.id ?? null };
}

export function crewConfigurationIssues(positions: RefereePosition[], assignments: ScheduleRefereeAssignmentInput[]): string[] {
  if (!assignments.length) return [];
  const issues: string[] = [];
  for (const assignment of assignments) {
    const position = positions.find((p) => p.code === assignment.position);
    if (!position) issues.push(`Vị trí ${assignment.position} không có trong cấu hình áp dụng.`);
    else if (position.capabilities.includes("FINALIZE") !== (assignment.isFinalAuthority === true)) issues.push(`Quyền xác nhận cuối cùng tại ${position.label} không khớp phân công.`);
  }
  for (const position of positions.filter((p) => p.required)) if (!assignments.some((a) => a.position === position.code)) issues.push(`Thiếu vị trí bắt buộc: ${position.label}.`);
  return issues;
}

import { AppError } from "../../lib/errors";
import type { RefereeAssignmentCandidate, RefereeDraftSlot, RefereeDuty, RefereeEligibilityIssue } from "../models/refereeAssignment";
import type { RefereePosition } from "../models/refereeConfiguration";
import { parseRefereePositions } from "./refereeConfigurationValidation";
import { REFEREE_CREW_POSITIONS } from "../crewValidation";

export function parseRefereeDraft(value: unknown) {
  const input = value as Record<string, unknown>;
  const invalid = (): never => { throw new AppError(400, "Phân công hoặc phiên bản lưu không hợp lệ.", "REFEREE_DRAFT_INVALID"); };
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["slots", "expectedRevision", "configurationRevision", "scheduleSignature", "matchPositions"].includes(key))
    || !Number.isSafeInteger(input.expectedRevision) || (input.expectedRevision as number) < 0
    || !Number.isSafeInteger(input.configurationRevision) || (input.configurationRevision as number) < 1
    || typeof input.scheduleSignature !== "string" || !/^[a-f0-9]{64}$/.test(input.scheduleSignature)
    || !Array.isArray(input.slots) || input.slots.length > 64) return invalid();
  const slots: RefereeDraftSlot[] = input.slots.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some((key) => !["position", "refereeId"].includes(key))
      || typeof row.position !== "string" || !/^[A-Z][A-Z0-9_]{1,59}$/.test(row.position)
      || typeof row.refereeId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.refereeId)) return invalid();
    return { position: row.position, refereeId: row.refereeId };
  });
  if (new Set(slots.map((slot) => slot.refereeId)).size !== slots.length || new Set(slots.map((slot) => slot.position)).size !== slots.length) {
    throw new AppError(400, "Mỗi người chỉ đảm nhiệm một vị trí và mỗi vị trí chỉ có một người trong trận.", "REFEREE_DRAFT_DUPLICATE");
  }
  return { slots, expectedRevision: input.expectedRevision as number, configurationRevision: input.configurationRevision as number,
    scheduleSignature: input.scheduleSignature, ...(input.matchPositions !== undefined ? { matchPositions: parseRefereePositions(input.matchPositions) } : {}) };
}

export function refereeEligibility(candidate: RefereeAssignmentCandidate, position: RefereePosition, context: {
  scheduleId: string; format: number; occupiedFrom: string; occupiedTo: string; minimumRestMinutes: number;
  venueId: string; travelMinutes: number; duties: RefereeDuty[];
}): { eligible: boolean; issues: RefereeEligibilityIssue[]; totalAssignments: number; restMinutes: number | null } {
  const issues: RefereeEligibilityIssue[] = [];
  const { identity, profile } = candidate;
  if (identity.accountStatus !== "ACTIVE" || !identity.isActive || !identity.emailVerified || !identity.roles.includes("REFEREE")) issues.push({ code: "ACCOUNT_INACTIVE", message: "Tài khoản chưa kích hoạt, chưa xác minh hoặc không có quyền trọng tài." });
  if (!profile.formats.includes(context.format as 5 | 7 | 11)) issues.push({ code: "FORMAT_MISMATCH", message: `Hồ sơ chưa có chuyên môn bóng đá ${context.format} người.` });
  const customQualified = !REFEREE_CREW_POSITIONS.has(position.code) && (position.capabilities.includes("FINALIZE") ? profile.positions.includes("REFEREE")
    : position.capabilities.includes("MANAGE_REPORT") ? profile.positions.some((code) => ["REFEREE", "MATCH_SECRETARY", "FOURTH_OFFICIAL"].includes(code)) : profile.positions.some((code) => REFEREE_CREW_POSITIONS.has(code)));
  if (!profile.positions.includes(position.code) && !customQualified) issues.push({ code: "POSITION_MISMATCH", message: `Hồ sơ chưa có chuyên môn cho vị trí ${position.label}.` });
  const start = Date.parse(context.occupiedFrom), end = Date.parse(context.occupiedTo);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new AppError(409, "Khoảng thời gian làm nhiệm vụ không hợp lệ.", "REFEREE_DRAFT_SCHEDULE_INVALID");
  if (profile.unavailablePeriods.some((period) => Date.parse(period.startAt) < end && Date.parse(period.endAt) > start)) issues.push({ code: "UNAVAILABLE", message: "Trọng tài đã khai báo không khả dụng trong khoảng làm nhiệm vụ." });
  const duties = context.duties.filter((duty) => duty.refereeId === candidate.userId && duty.scheduleId !== context.scheduleId);
  let nearest = Number.POSITIVE_INFINITY;
  for (const duty of duties) {
    const from = Date.parse(duty.startsAt), to = Date.parse(duty.endsAt);
    if (from < end && to > start) { issues.push({ code: "DUTY_OVERLAP", message: `Trùng thời gian với trận ${duty.matchId}, kể cả nhiệm vụ ở giải khác.` }); nearest = 0; continue; }
    const gap = start >= to ? (start - to) / 60000 : (from - end) / 60000;
    nearest = Math.min(nearest, gap);
    const required = Math.max(context.minimumRestMinutes, duty.minimumRestMinutes) + (duty.venueId !== context.venueId ? context.travelMinutes : 0);
    if (gap < required) issues.push({ code: "REST_REQUIRED", message: `Chưa đủ ${required} phút nghỉ/di chuyển với trận ${duty.matchId}.` });
  }
  return { eligible: !issues.length, issues, totalAssignments: duties.length, restMinutes: Number.isFinite(nearest) ? Math.round(nearest) : null };
}

export function draftCompleteness(positions: RefereePosition[], slots: RefereeDraftSlot[]) {
  const missing = positions.filter((position) => position.required && !slots.some((slot) => slot.position === position.code));
  return { complete: positions.length > 0 && !missing.length, assigned: slots.length, required: positions.filter((position) => position.required).length, missing: missing.map((position) => position.label) };
}

import { AppError } from "../../lib/errors";
import { parseRefereeRequestId } from "./refereeTeamValidation";
import type { RefereePosition } from "../models/refereeConfiguration";
import type { RefereeDraftSlot } from "../models/refereeAssignment";
import { validateCrewAssignments } from "../crewValidation";

/** Draft validation permits empty crews; official publication deliberately does not. */
export function validateOfficialRefereeCrew(positions: RefereePosition[], slots: RefereeDraftSlot[]): void {
  const missing = positions.filter((position) => position.required && !slots.some((slot) => slot.position === position.code));
  if (!positions.length || !slots.length || missing.length) throw new AppError(409, "Phân công chưa đủ vị trí bắt buộc; không thể công bố.", "REFEREE_CONFIG_ASSIGNMENT_CONFLICT", { issues: missing.map((position) => `Thiếu vị trí bắt buộc: ${position.label}.`) });
  validateCrewAssignments(slots.map((slot) => ({ ...slot, isFinalAuthority: positions.find((position) => position.code === slot.position)?.capabilities.includes("FINALIZE") })), positions);
}

export interface PublishRefereeMatch { matchId: string; expectedRevision: number; configurationRevision: number; scheduleSignature: string }
function object(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new AppError(400, "Dữ liệu công bố/thay thế không hợp lệ.", "REFEREE_PUBLICATION_INVALID");
  return value as Record<string, unknown>;
}
const revision = (value: unknown, zero = false): number => {
  if (!Number.isSafeInteger(value) || (value as number) < (zero ? 0 : 1)) throw new AppError(400, "Phiên bản phân công không hợp lệ.", "REFEREE_PUBLICATION_INVALID");
  return value as number;
};
const signature = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new AppError(400, "Chữ ký lịch không hợp lệ.", "REFEREE_PUBLICATION_INVALID");
  return value;
};
export function parseRefereePublication(value: unknown) {
  const input = object(value, ["requestId", "matches"]);
  if (!Array.isArray(input.matches) || !input.matches.length || input.matches.length > 500) throw new AppError(400, "Chọn từ 1 đến 500 trận để công bố.", "REFEREE_PUBLICATION_SCOPE_INVALID");
  const matches: PublishRefereeMatch[] = input.matches.map((value) => {
    const row = object(value, ["matchId", "expectedRevision", "configurationRevision", "scheduleSignature"]);
    return { matchId: parseRefereeRequestId(row.matchId), expectedRevision: revision(row.expectedRevision), configurationRevision: revision(row.configurationRevision), scheduleSignature: signature(row.scheduleSignature) };
  }).sort((a, b) => a.matchId.localeCompare(b.matchId));
  if (new Set(matches.map((row) => row.matchId)).size !== matches.length) throw new AppError(400, "Phạm vi có trận bị chọn trùng.", "REFEREE_PUBLICATION_SCOPE_INVALID");
  return { requestId: parseRefereeRequestId(input.requestId), matches };
}
export function parseRefereeReplacement(value: unknown) {
  const input = object(value, ["requestId", "expectedPublicationRevision", "scheduleSignature", "position", "oldRefereeId", "newRefereeId", "reason"]);
  if (typeof input.position !== "string" || !/^[A-Z][A-Z0-9_]{1,59}$/.test(input.position) || typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 1000) throw new AppError(400, "Chọn vị trí và nhập lý do thay thế (tối đa 1.000 ký tự).", "REFEREE_REPLACEMENT_INVALID");
  const oldRefereeId = parseRefereeRequestId(input.oldRefereeId), newRefereeId = parseRefereeRequestId(input.newRefereeId);
  if (oldRefereeId === newRefereeId) throw new AppError(400, "Người thay thế phải khác trọng tài hiện tại.", "REFEREE_REPLACEMENT_SAME_PERSON");
  return { requestId: parseRefereeRequestId(input.requestId), expectedPublicationRevision: revision(input.expectedPublicationRevision), scheduleSignature: signature(input.scheduleSignature), position: input.position, oldRefereeId, newRefereeId, reason: input.reason.trim() };
}

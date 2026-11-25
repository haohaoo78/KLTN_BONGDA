import { randomUUID } from "node:crypto";
import { AppError } from "../lib/errors";
import { REFEREE_CREW_POSITIONS } from "../crewValidation";
import type { RefereeQualificationLevel, RefereeTeamProfile } from "../models/refereeTeam";

const levels = new Set<RefereeQualificationLevel>(["UNVERIFIED", "ENTRY", "CITY", "NATIONAL", "INTERNATIONAL"]);
const profileKeys = new Set(["organization", "club", "formats", "level", "experienceYears", "positions", "unavailablePeriods", "notes"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const invalid = (message: string): never => { throw new AppError(400, message, "INVALID_REFEREE_TEAM_INPUT"); };
const text = (value: unknown, max: number, label: string) => {
  if (typeof value !== "string" || value.trim().length > max) return invalid(`${label} không hợp lệ.`);
  return value.trim();
};

export function parseRefereeRequestId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) return invalid("Mã thao tác phải là UUID hợp lệ.");
  return value.toLowerCase();
}

export function parseRefereeEmail(value: unknown): string {
  const email = text(value, 254, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid("Nhập địa chỉ email hợp lệ.");
  return email;
}

export function emptyRefereeTeamProfile(): RefereeTeamProfile {
  return { organization: "", club: "", formats: [], level: "UNVERIFIED", experienceYears: 0, positions: [], unavailablePeriods: [], notes: "" };
}

export function parseRefereeTeamProfile(value: unknown, current = emptyRefereeTeamProfile()): RefereeTeamProfile {
  if (!object(value) || Object.keys(value).some((key) => !profileKeys.has(key))) return invalid("Chỉ được cập nhật hồ sơ chuyên môn của trọng tài trong giải.");
  const profile: RefereeTeamProfile = { ...current, formats: [...current.formats], positions: [...current.positions], unavailablePeriods: current.unavailablePeriods.map((period) => ({ ...period })) };
  for (const field of ["organization", "club", "notes"] as const) if (value[field] !== undefined) profile[field] = text(value[field], field === "notes" ? 2_000 : 200, field);
  if (value.level !== undefined) {
    if (typeof value.level !== "string" || !levels.has(value.level as RefereeQualificationLevel)) return invalid("Cấp độ chuyên môn không hợp lệ.");
    profile.level = value.level as RefereeQualificationLevel;
  }
  if (value.experienceYears !== undefined) {
    if (typeof value.experienceYears !== "number" || !Number.isInteger(value.experienceYears) || value.experienceYears < 0 || value.experienceYears > 80) return invalid("Số năm kinh nghiệm phải từ 0 đến 80.");
    profile.experienceYears = value.experienceYears;
  }
  if (value.formats !== undefined) {
    if (!Array.isArray(value.formats) || value.formats.length > 3 || value.formats.some((format) => ![5, 7, 11].includes(format)) || new Set(value.formats).size !== value.formats.length) return invalid("Loại bóng phải thuộc 5, 7 hoặc 11 người và không trùng nhau.");
    profile.formats = value.formats as Array<5 | 7 | 11>;
  }
  if (value.positions !== undefined) {
    if (!Array.isArray(value.positions) || value.positions.length > REFEREE_CREW_POSITIONS.size || value.positions.some((position) => typeof position !== "string" || !REFEREE_CREW_POSITIONS.has(position)) || new Set(value.positions).size !== value.positions.length) return invalid("Vị trí trọng tài không hợp lệ hoặc bị trùng.");
    profile.positions = value.positions as string[];
  }
  if (value.unavailablePeriods !== undefined) {
    if (!Array.isArray(value.unavailablePeriods) || value.unavailablePeriods.length > 200) return invalid("Danh sách thời gian không khả dụng không hợp lệ.");
    profile.unavailablePeriods = value.unavailablePeriods.map((raw) => {
      if (!object(raw) || Object.keys(raw).some((key) => !["id", "startAt", "endAt", "reason"].includes(key))) return invalid("Khoảng thời gian không khả dụng không hợp lệ.");
      const startAt = text(raw.startAt, 40, "Thời gian bắt đầu");
      const endAt = text(raw.endAt, 40, "Thời gian kết thúc");
      const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;
      const validDateTime = (time: string) => iso.test(time) && Number.isFinite(Date.parse(time))
        && Number(time.slice(11, 13)) < 24 && new Date(`${time.slice(0, 10)}T12:00:00Z`).toISOString().slice(0, 10) === time.slice(0, 10);
      if (!validDateTime(startAt) || !validDateTime(endAt) || Date.parse(startAt) >= Date.parse(endAt)) return invalid("Thời gian bắt đầu phải trước thời gian kết thúc.");
      return { id: raw.id === undefined ? randomUUID() : parseRefereeRequestId(raw.id), startAt, endAt, reason: raw.reason === undefined ? "" : text(raw.reason, 500, "Lý do") };
    });
    if (new Set(profile.unavailablePeriods.map((period) => period.id)).size !== profile.unavailablePeriods.length) return invalid("Khoảng thời gian không khả dụng bị trùng mã.");
  }
  return profile;
}

export function parseAddRefereeTeamInput(value: unknown) {
  if (!object(value) || Object.keys(value).some((key) => !["email", "fullName", "phone", "profile", "requestId"].includes(key))) return invalid("Thông tin thêm trọng tài không hợp lệ.");
  const fullName = value.fullName === undefined ? undefined : text(value.fullName, 200, "Họ tên");
  const phone = value.phone === undefined ? undefined : text(value.phone, 30, "Số điện thoại");
  if (phone && !/^\+?[0-9 ()-]{6,30}$/.test(phone)) return invalid("Số điện thoại không hợp lệ.");
  return { email: parseRefereeEmail(value.email), fullName, phone, requestId: parseRefereeRequestId(value.requestId), profile: value.profile === undefined ? emptyRefereeTeamProfile() : parseRefereeTeamProfile(value.profile) };
}

export function parseRefereeProfilePatch(value: unknown, current: RefereeTeamProfile): RefereeTeamProfile {
  if (!object(value) || Object.keys(value).length !== 1 || !("profile" in value)) return invalid("Chỉ được chỉnh sửa hồ sơ chuyên môn; thông tin tài khoản được quản lý tại Auth Service.");
  return parseRefereeTeamProfile(value.profile, current);
}

export function parseRefereeResendInput(value: unknown): string {
  if (!object(value) || Object.keys(value).length !== 1 || !("requestId" in value)) return invalid("Thông tin gửi lại email không hợp lệ.");
  return parseRefereeRequestId(value.requestId);
}

import { UserRole, type UserRole as UserRoleType } from "@sfl/shared";
import { AppError } from "./errors";

const ALL_ROLES = new Set<string>(Object.values(UserRole));

export function parseRoles(raw: unknown): UserRoleType[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new AppError(400, "roles must be a non-empty array", "VALIDATION_ERROR");
  }
  const roles: UserRoleType[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !ALL_ROLES.has(item)) {
      throw new AppError(400, "Invalid role value", "VALIDATION_ERROR");
    }
    if (!roles.includes(item as UserRoleType)) {
      roles.push(item as UserRoleType);
    }
  }
  return roles;
}

export function parseRolesHeader(header: string | undefined): UserRoleType[] {
  if (!header) return [];
  const roles: UserRoleType[] = [];
  for (const part of header.split(",")) {
    const role = part.trim();
    if (!role) continue;
    if (!ALL_ROLES.has(role)) continue;
    const typed = role as UserRoleType;
    if (!roles.includes(typed)) roles.push(typed);
  }
  return roles;
}

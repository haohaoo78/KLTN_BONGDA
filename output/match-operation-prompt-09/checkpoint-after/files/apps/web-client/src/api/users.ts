import type { UserProfilePublic, UserRole } from "@sfl/shared";
import { apiFetch } from "./client";

export type RoleApplication = {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  requestedRole: "TEAM_CAPTAIN" | "PLAYER";
  institutionId: string;
  applicationData: Record<string, unknown>;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN";
  decisionNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function getMyProfile(): Promise<{ user: UserProfilePublic }> {
  return apiFetch("/users/me");
}

export type AccountProfileHistoryRecord = {
  id: number;
  changes: Record<string, unknown>;
  changedAt: string;
};

export async function getMyProfileHistory(): Promise<{ history: AccountProfileHistoryRecord[] }> {
  return apiFetch("/users/me/profile-history");
}

export async function getUserProfileHistory(userId: string): Promise<{ history: AccountProfileHistoryRecord[] }> {
  return apiFetch(`/users/${encodeURIComponent(userId)}/profile-history`);
}

export async function updateMyProfile(input: {
  fullName: string;
  studentId?: string | null;
  profileData: NonNullable<UserProfilePublic["profileData"]>;
}): Promise<{ user: UserProfilePublic }> {
  return apiFetch("/users/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function changeMyPassword(input: {
  oldPassword: string;
  newPassword: string;
}): Promise<{ message: string }> {
  return apiFetch("/users/me/change-password", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function requestEmailChange(input: {
  email: string;
  currentPassword: string;
}): Promise<{ message: string }> {
  return apiFetch("/users/me/email-change", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getMyRoleApplications(): Promise<{ applications: RoleApplication[] }> {
  return apiFetch("/users/me/role-applications");
}

export async function submitRoleApplication(input: {
  requestedRole: "TEAM_CAPTAIN" | "PLAYER";
  institutionId: string;
  applicationData: Record<string, unknown>;
  message: string;
}): Promise<{ application: RoleApplication }> {
  return apiFetch("/users/me/role-applications", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateMyRoleApplication(input: {
  applicationId: string;
  institutionId: string;
  applicationData: Record<string, unknown>;
  message: string;
}): Promise<{ application: RoleApplication }> {
  return apiFetch(`/users/me/role-applications/${encodeURIComponent(input.applicationId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      institutionId: input.institutionId,
      applicationData: input.applicationData,
      message: input.message,
    }),
  });
}

export async function withdrawMyRoleApplication(
  applicationId: string,
): Promise<{ application: RoleApplication }> {
  return apiFetch(`/users/me/role-applications/${encodeURIComponent(applicationId)}/withdraw`, {
    method: "POST",
  });
}

export async function getRoleApplications(status = "PENDING"): Promise<{
  applications: RoleApplication[];
  pagination: { limit: number; offset: number; total: number };
}> {
  return apiFetch(`/users/role-applications?status=${encodeURIComponent(status)}&limit=100`);
}

export async function listRoleApplications(filters: {
  status?: RoleApplication["status"];
  requestedRole?: RoleApplication["requestedRole"];
  search?: string;
  institutionId?: string;
  createdFrom?: string;
  createdTo?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{
  applications: RoleApplication[];
  pagination: { limit: number; offset: number; total: number };
}> {
  const query = new URLSearchParams({
    limit: String(filters.limit ?? 10),
    offset: String(filters.offset ?? 0),
  });
  if (filters.status) query.set("status", filters.status);
  if (filters.requestedRole) query.set("requestedRole", filters.requestedRole);
  if (filters.search) query.set("search", filters.search);
  if (filters.institutionId) query.set("institutionId", filters.institutionId);
  if (filters.createdFrom) query.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) query.set("createdTo", filters.createdTo);
  return apiFetch(`/users/role-applications?${query.toString()}`);
}

export async function reviewRoleApplication(input: {
  applicationId: string;
  decision: "APPROVED" | "REJECTED";
  decisionNote?: string;
}): Promise<{ application: RoleApplication; notificationWarning?: string }> {
  return apiFetch(`/users/role-applications/${encodeURIComponent(input.applicationId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      decision: input.decision,
      decisionNote: input.decisionNote,
    }),
  });
}

export async function listUsers(filters: {
  search?: string;
  role?: UserRole;
  status?: "pending" | "active" | "inactive" | "disabled";
  institutionId?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: "createdAt" | "fullName" | "email";
  sortDirection?: "asc" | "desc";
  limit?: number;
  offset?: number;
} = {}): Promise<{
  users: UserProfilePublic[];
  pagination: { limit: number; offset: number; total: number };
  statistics: { total: number; active: number; locked: number; pending: number; disabled: number };
}> {
  const query = new URLSearchParams({
    limit: String(filters.limit ?? 100),
    offset: String(filters.offset ?? 0),
  });
  if (filters.search) query.set("search", filters.search);
  if (filters.role) query.set("role", filters.role);
  if (filters.status) query.set("status", filters.status);
  if (filters.institutionId) query.set("institutionId", filters.institutionId);
  if (filters.createdFrom) query.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) query.set("createdTo", filters.createdTo);
  if (filters.sortBy) query.set("sortBy", filters.sortBy);
  if (filters.sortDirection) query.set("sortDirection", filters.sortDirection);
  return apiFetch(`/users?${query.toString()}`);
}

export async function getUserById(userId: string): Promise<{ user: UserProfilePublic }> {
  return apiFetch(`/users/${encodeURIComponent(userId)}`);
}

export async function createStaffAccount(input: {
  email: string;
  fullName: string;
  role: "BTC" | "REFEREE";
  institutionId?: string;
}): Promise<{ user: UserProfilePublic }> {
  return apiFetch("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateUserAccount(
  userId: string,
  changes: {
    fullName?: string;
    studentId?: string | null;
    roles?: UserRole[];
    isActive?: boolean;
    accountStatus?: "ACTIVE" | "LOCKED" | "DISABLED";
    institutionId?: string | null;
    statusReason?: string | null;
    profileData?: { phone?: string | null; address?: string | null };
  },
): Promise<{ user: UserProfilePublic; notificationWarning?: string }> {
  return apiFetch(`/users/${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export async function resendStaffActivation(userId: string): Promise<{ message: string }> {
  return apiFetch(`/users/${encodeURIComponent(userId)}/resend-activation`, {
    method: "POST",
  });
}

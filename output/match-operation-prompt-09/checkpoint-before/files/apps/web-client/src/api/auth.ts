import type { AuthUserPublic } from "@sfl/shared";
import { apiFetch, ApiError } from "./client";

export { ApiError as AuthApiError } from "./client";

export async function login(
  email: string,
  password: string,
): Promise<{ user: AuthUserPublic }> {
  return apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/auth/logout", { method: "POST" });
}

export async function getMe(): Promise<{ user: AuthUserPublic }> {
  return apiFetch("/auth/me");
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  role?: "VIEWER" | "TEAM_CAPTAIN" | "PLAYER";
  studentId?: string;
}): Promise<{ message: string }> {
  return apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function resendVerification(email: string): Promise<{ message: string }> {
  return apiFetch("/auth/resend-verification", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function verifyEmail(token: string): Promise<{ message: string }> {
  return apiFetch(`/auth/verify-email/${encodeURIComponent(token)}`, {
    method: "POST",
  });
}

export async function confirmEmailChange(token: string): Promise<{ message: string }> {
  return apiFetch(`/auth/confirm-email-change/${encodeURIComponent(token)}`, {
    method: "POST",
  });
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  return apiFetch("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ message: string }> {
  return apiFetch("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
}

export async function activateStaffAccount(
  token: string,
  password: string,
): Promise<{ message: string }> {
  return apiFetch("/auth/activate-account", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

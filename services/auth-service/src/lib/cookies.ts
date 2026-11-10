import type { Response } from "express";
import { config } from "../config";

export function readSessionIdFromCookie(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  const name = config.sessionCookieName;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

export function readRefreshTokenFromCookie(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  const name = config.refreshCookieName;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return undefined;
}

function appendCookie(res: Response, cookie: string): void {
  const current = res.getHeader("Set-Cookie");
  const cookies = Array.isArray(current)
    ? current.map(String)
    : current
      ? [String(current)]
      : [];
  res.setHeader("Set-Cookie", [...cookies, cookie]);
}

export function setSessionCookie(res: Response, sessionId: string): void {
  const maxAge = config.sessionTtlSeconds;
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(sessionId)}`,
    "Path=/",
    "HttpOnly",
    `Max-Age=${maxAge}`,
    "SameSite=Lax",
  ];
  if (config.cookieSecure) {
    parts.push("Secure");
  }
  appendCookie(res, parts.join("; "));
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  const parts = [
    `${config.refreshCookieName}=${encodeURIComponent(refreshToken)}`,
    "Path=/api/auth",
    "HttpOnly",
    `Max-Age=${config.refreshTokenTtlSeconds}`,
    "SameSite=Lax",
  ];
  if (config.cookieSecure) {
    parts.push("Secure");
  }
  appendCookie(res, parts.join("; "));
}

export function clearSessionCookie(res: Response): void {
  const parts = [
    `${config.sessionCookieName}=`,
    "Path=/",
    "HttpOnly",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (config.cookieSecure) {
    parts.push("Secure");
  }
  appendCookie(res, parts.join("; "));
}

export function clearRefreshCookie(res: Response): void {
  const parts = [
    `${config.refreshCookieName}=`,
    "Path=/api/auth",
    "HttpOnly",
    "Max-Age=0",
    "SameSite=Lax",
  ];
  if (config.cookieSecure) {
    parts.push("Secure");
  }
  appendCookie(res, parts.join("; "));
}

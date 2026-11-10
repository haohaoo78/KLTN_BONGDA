import type { NextFunction, Request, Response } from "express";
import type { AuthUserPublic, UserRole } from "@sfl/shared";
import { config } from "../config";

const SPOOF_HEADERS = [
  "x-user-id",
  "x-user-email",
  "x-user-roles",
  "x-user-institution-id",
  "x-user-name",
] as const;

export type AuthenticatedRequest = Request & {
  authUser?: AuthUserPublic;
};

function stripSpoofedUserHeaders(req: Request): void {
  for (const name of SPOOF_HEADERS) {
    delete req.headers[name];
  }
}

export function sessionMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  void requireSession(req, res, next).catch(next);
}

/** Gắn user headers nếu có cookie; không bắt buộc đăng nhập (route public). */
export function optionalSessionMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  void attachSessionIfPresent(req, res, next).catch(next);
}

async function attachSessionIfPresent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  stripSpoofedUserHeaders(req);
  if (!req.headers.cookie) {
    next();
    return;
  }

  const validateUrl = `${config.authServiceUrl.replace(/\/$/, "")}/auth/session/validate`;
  try {
    const authRes = await fetch(validateUrl, {
      method: "GET",
      headers: { cookie: req.headers.cookie },
    });
    if (!authRes.ok) {
      next();
      return;
    }
    const body = (await authRes.json()) as { user?: AuthUserPublic };
    if (body.user?.userId && body.user.email && Array.isArray(body.user.roles)) {
      req.authUser = body.user;
      req.headers["x-user-id"] = body.user.userId;
      req.headers["x-user-email"] = body.user.email;
      req.headers["x-user-roles"] = body.user.roles.join(",");
      if (body.user.fullName) {
        req.headers["x-user-name"] = Buffer.from(body.user.fullName, "utf8").toString("base64url");
      }
      if (body.user.institutionId) {
        req.headers["x-user-institution-id"] = body.user.institutionId;
      }
    }
  } catch {
    // Public routes vẫn tiếp tục nếu auth-service tạm lỗi
  }
  next();
}

async function requireSession(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  stripSpoofedUserHeaders(req);

  const validateUrl = `${config.authServiceUrl.replace(/\/$/, "")}/auth/session/validate`;

  let authRes: globalThis.Response;
  try {
    authRes = await fetch(validateUrl, {
      method: "GET",
      headers: {
        cookie: req.headers.cookie ?? "",
      },
    });
  } catch {
    res.status(503).json({
      error: {
        message: "Auth service unavailable",
        code: "AUTH_SERVICE_UNAVAILABLE",
      },
    });
    return;
  }

  if (authRes.status === 401) {
    res.status(401).json({
      error: {
        message: "Not authenticated",
        code: "UNAUTHENTICATED",
      },
    });
    return;
  }

  if (!authRes.ok) {
    res.status(502).json({
      error: {
        message: "Session validation failed",
        code: "AUTH_SERVICE_ERROR",
      },
    });
    return;
  }

  const body = (await authRes.json()) as { user?: AuthUserPublic };
  if (!body.user?.userId || !body.user.email || !Array.isArray(body.user.roles)) {
    res.status(502).json({
      error: {
        message: "Invalid auth service response",
        code: "AUTH_SERVICE_ERROR",
      },
    });
    return;
  }

  req.authUser = body.user;
  req.headers["x-user-id"] = body.user.userId;
  req.headers["x-user-email"] = body.user.email;
  req.headers["x-user-roles"] = body.user.roles.join(",");
  if (body.user.fullName) {
    req.headers["x-user-name"] = Buffer.from(body.user.fullName, "utf8").toString("base64url");
  }
  if (body.user.institutionId) {
    req.headers["x-user-institution-id"] = body.user.institutionId;
  }

  next();
}

export function attachSessionHeadersForProxy(
  proxyReq: import("node:http").ClientRequest,
  req: AuthenticatedRequest,
): void {
  const user = req.authUser;
  if (!user) return;
  proxyReq.setHeader("x-user-id", user.userId);
  proxyReq.setHeader("x-user-email", user.email);
  proxyReq.setHeader("x-user-roles", user.roles.join(","));
  if (user.fullName) {
    proxyReq.setHeader(
      "x-user-name",
      Buffer.from(user.fullName, "utf8").toString("base64url"),
    );
  }
  if (user.institutionId) {
    proxyReq.setHeader("x-user-institution-id", user.institutionId);
  }
}

export function parseRolesHeader(value: string | undefined): UserRole[] {
  if (!value) return [];
  return value.split(",").map((r) => r.trim()).filter(Boolean) as UserRole[];
}

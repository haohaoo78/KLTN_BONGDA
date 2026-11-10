import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@sfl/shared";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { AppError } from "../lib/errors";
import { parseRolesHeader } from "../lib/roles";

export type UserContext = {
  userId: string;
  email: string;
  roles: UserRole[];
};

export type RequestWithUser = Request & {
  userContext: UserContext;
};

export function requireTrustedGateway(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const rawKey = req.headers["x-gateway-internal-key"];
  const providedKey = Buffer.from(typeof rawKey === "string" ? rawKey : "");
  const expectedKey = Buffer.from(config.internalApiKey);
  if (!expectedKey.length) {
    next(new AppError(503, "Gateway authentication is not configured", "SERVICE_MISCONFIGURED"));
    return;
  }
  if (
    providedKey.length !== expectedKey.length ||
    !timingSafeEqual(providedKey, expectedKey)
  ) {
    next(new AppError(401, "Untrusted gateway request", "UNAUTHENTICATED"));
    return;
  }
  next();
}

export function requireGatewayUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  requireTrustedGateway(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    const userId = req.headers["x-user-id"];
    const email = req.headers["x-user-email"];
    const rolesHeader = req.headers["x-user-roles"];

    if (typeof userId !== "string" || !userId) {
      next(new AppError(401, "Missing user context", "UNAUTHENTICATED"));
      return;
    }
    if (typeof email !== "string" || !email) {
      next(new AppError(401, "Missing user context", "UNAUTHENTICATED"));
      return;
    }

    (req as RequestWithUser).userContext = {
      userId,
      email,
      roles: parseRolesHeader(
        typeof rolesHeader === "string" ? rolesHeader : undefined,
      ),
    };
    next();
  });
}

export function requireRoles(...allowed: UserRole[]) {
  const allowSet = new Set(allowed);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = (req as RequestWithUser).userContext;
    if (!ctx) {
      next(new AppError(401, "Missing user context", "UNAUTHENTICATED"));
      return;
    }
    const ok = ctx.roles.some((role) => allowSet.has(role));
    if (!ok) {
      next(new AppError(403, "Forbidden", "FORBIDDEN"));
      return;
    }
    next();
  };
}

export function requireSelfOrAdmin(paramKey = "id") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = (req as RequestWithUser).userContext;
    if (!ctx) {
      next(new AppError(401, "Missing user context", "UNAUTHENTICATED"));
      return;
    }
    const targetId = req.params[paramKey];
    const isAdmin = ctx.roles.includes("ADMIN");
    if (isAdmin || ctx.userId === targetId) {
      next();
      return;
    }
    next(new AppError(403, "Forbidden", "FORBIDDEN"));
  };
}

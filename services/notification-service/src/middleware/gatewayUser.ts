import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { AppError } from "../lib/errors";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRoles?: string[];
}

function headerMatchesSecret(value: string | undefined, secret: string): boolean {
  if (!value) return false;
  const provided = Buffer.from(value);
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function requireGatewayUser(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  if (!config.internalApiKey) {
    throw new AppError(503, "Gateway authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  if (
    !headerMatchesSecret(
      req.headers["x-gateway-internal-key"] as string | undefined,
      config.internalApiKey,
    )
  ) {
    throw new AppError(401, "Untrusted gateway request", "UNAUTHENTICATED");
  }

  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }

  req.userId = userId;
  req.userRoles = String(req.headers["x-user-roles"] ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  next();
}

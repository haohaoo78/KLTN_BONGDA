import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { AppError } from "../lib/errors";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRoles?: string[];
}

export function requireGatewayUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const rawKey = req.headers["x-gateway-internal-key"];
  const providedKey = Buffer.from(typeof rawKey === "string" ? rawKey : "");
  const expectedKey = Buffer.from(config.internalApiKey);

  if (!expectedKey.length) {
    throw new AppError(503, "Gateway authentication is not configured", "SERVICE_MISCONFIGURED");
  }
  if (
    providedKey.length !== expectedKey.length ||
    !timingSafeEqual(providedKey, expectedKey)
  ) {
    throw new AppError(401, "Untrusted gateway request", "UNAUTHENTICATED");
  }

  const userIdHeader = req.headers["x-user-id"];
  const rolesHeader = req.headers["x-user-roles"];
  const userId = typeof userIdHeader === "string" ? userIdHeader : "";
  const userRoles = typeof rolesHeader === "string" ? rolesHeader : "";
  if (!userId) {
    throw new AppError(401, "Missing user authentication", "UNAUTHENTICATED");
  }

  req.userId = userId;
  req.userRoles = userRoles.split(",").map((role) => role.trim()).filter(Boolean);

  next();
}

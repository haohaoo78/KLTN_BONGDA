import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { AppError } from "../lib/errors";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRoles?: string[];
  userInstitutionId?: string;
}

export function requireTrustedGateway(
  req: Request,
  _res: Response,
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
  next();
}

export function requireGatewayUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  requireTrustedGateway(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }

    const userIdHeader = req.headers["x-user-id"];
    const rolesHeader = req.headers["x-user-roles"];
    const userId = typeof userIdHeader === "string" ? userIdHeader : "";
    const userRoles = typeof rolesHeader === "string" ? rolesHeader : "";
    if (!userId) {
      next(new AppError(401, "Missing user authentication", "UNAUTHENTICATED"));
      return;
    }

    const authenticatedReq = req as AuthenticatedRequest;
    authenticatedReq.userId = userId;
    authenticatedReq.userRoles = userRoles.split(",").map((role) => role.trim()).filter(Boolean);
    const institutionIdHeader = req.headers["x-user-institution-id"];
    authenticatedReq.userInstitutionId =
      typeof institutionIdHeader === "string" ? institutionIdHeader : undefined;

    next();
  });
}

export function optionalGatewayUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  requireTrustedGateway(req, res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }

    const userIdHeader = req.headers["x-user-id"];
    const rolesHeader = req.headers["x-user-roles"];
    if (typeof userIdHeader === "string" && userIdHeader) {
      req.userId = userIdHeader;
      req.userRoles = typeof rolesHeader === "string"
        ? rolesHeader.split(",").map((role) => role.trim()).filter(Boolean)
        : [];
      const institutionIdHeader = req.headers["x-user-institution-id"];
      req.userInstitutionId = typeof institutionIdHeader === "string" ? institutionIdHeader : undefined;
    }
    next();
  });
}

import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { AppError } from "../lib/errors";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  userRoles?: string[];
  userInstitutionId?: string;
  userFullName?: string;
}

export function requireTrustedGateway(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const internalKey = req.headers["x-gateway-internal-key"];
  const providedKey = typeof internalKey === "string" ? Buffer.from(internalKey) : Buffer.alloc(0);
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
  _res: Response,
  next: NextFunction,
): void {
  requireTrustedGateway(req, _res, (err?: unknown) => {
    if (err) {
      next(err);
      return;
    }

    const userIdHeader = req.headers["x-user-id"];
    const userEmailHeader = req.headers["x-user-email"];
    const userRolesHeader = req.headers["x-user-roles"];
    const userInstitutionHeader = req.headers["x-user-institution-id"];
    const userNameHeader = req.headers["x-user-name"];
    const userId = typeof userIdHeader === "string" ? userIdHeader : "";
    const userEmail = typeof userEmailHeader === "string" ? userEmailHeader : "";
    const userRoles = typeof userRolesHeader === "string" ? userRolesHeader : "";

    if (!userId) {
      next(new AppError(401, "Missing user authentication", "UNAUTHENTICATED"));
      return;
    }

    const authenticatedReq = req as AuthenticatedRequest;
    authenticatedReq.userId = userId;
    authenticatedReq.userEmail = userEmail || undefined;
    authenticatedReq.userRoles = userRoles ? userRoles.split(",").map((role) => role.trim()).filter(Boolean) : [];
    authenticatedReq.userInstitutionId = typeof userInstitutionHeader === "string" ? userInstitutionHeader : undefined;
    authenticatedReq.userFullName = typeof userNameHeader === "string"
      ? Buffer.from(userNameHeader, "base64url").toString("utf8")
      : undefined;

    next();
  });
}

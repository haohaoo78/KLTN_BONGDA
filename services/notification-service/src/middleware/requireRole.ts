import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./gatewayUser";
import { AppError } from "../lib/errors";

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!allowedRoles.some((role) => req.userRoles?.includes(role))) {
      throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
    }
    next();
  };
}

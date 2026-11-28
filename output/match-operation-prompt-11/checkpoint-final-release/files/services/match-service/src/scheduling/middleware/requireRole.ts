import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import type { AuthenticatedRequest } from "./gatewayUser";

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const userRoles = req.userRoles ?? [];

    const hasRole = allowedRoles.some((role) => userRoles.includes(role));

    if (!hasRole) {
      throw new AppError(403, "Insufficient permissions", "FORBIDDEN");
    }

    next();
  };
}

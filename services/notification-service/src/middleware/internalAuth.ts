import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { AppError } from "../lib/errors";
import { config } from "../config";

export function requireInternalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const rawKey = req.headers["x-internal-api-key"];
  const providedKey = Buffer.from(typeof rawKey === "string" ? rawKey : "");
  const expectedKey = Buffer.from(config.internalApiKey);

  if (
    !expectedKey.length ||
    providedKey.length !== expectedKey.length ||
    !timingSafeEqual(providedKey, expectedKey)
  ) {
    next(new AppError(401, "Untrusted internal request", "UNAUTHENTICATED"));
    return;
  }
  next();
}

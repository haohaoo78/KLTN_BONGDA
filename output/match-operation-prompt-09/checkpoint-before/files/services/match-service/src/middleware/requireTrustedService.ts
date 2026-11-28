import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config";
import { AppError } from "../lib/errors";

export function requireTrustedService(req: Request, _res: Response, next: NextFunction) {
  const raw = req.headers["x-gateway-internal-key"];
  const received = Buffer.from(typeof raw === "string" ? raw : "");
  const expected = Buffer.from(config.internalApiKey);
  if (!expected.length) throw new AppError(503, "Internal service authentication is not configured", "SERVICE_MISCONFIGURED");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new AppError(401, "Untrusted internal service request", "UNAUTHENTICATED");
  }
  next();
}

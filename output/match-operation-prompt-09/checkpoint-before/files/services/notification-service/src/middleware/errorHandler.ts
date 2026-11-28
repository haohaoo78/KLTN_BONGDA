import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
      },
    });
    return;
  }

  console.error("[notification-service] unhandled error:", err);
  res.status(500).json({
    error: {
      message: "Internal server error",
      code: "INTERNAL_ERROR",
    },
  });
}

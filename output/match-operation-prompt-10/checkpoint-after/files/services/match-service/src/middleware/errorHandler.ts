import { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error("[match-service] error:", err);

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: {
        message: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  if(err&&typeof err==="object"&&"code" in err&&(err as {code?:string}).code==="P0010"){
    res.status(409).json({error:{code:"TOURNAMENT_COMPLETION_LOCKED",message:"Giải đang trong quy trình kết thúc; không thể thay đổi trận, khiếu nại hoặc kháng nghị."}});
    return;
  }

  if (err instanceof Error) {
    res.status(500).json({
      error: {
        message: "Internal server error",
        code: "INTERNAL_ERROR",
      },
    });
    return;
  }

  res.status(500).json({
    error: {
      message: "Unknown error",
      code: "UNKNOWN_ERROR",
    },
  });
}

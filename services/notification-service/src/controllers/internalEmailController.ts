import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";
import { EmailDeliveryService } from "../services/emailDeliveryService";

export class InternalEmailController {
  constructor(private readonly emailDeliveryService: EmailDeliveryService) {}

  async sendAccountEmail(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const type = req.body?.type;
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const token = typeof req.body?.token === "string" ? req.body.token : "";
      const staffRole = req.body?.staffRole;

      if (
        type !== "verification" &&
        type !== "password_reset" &&
        type !== "account_activation" &&
        type !== "email_change"
      ) {
        throw new AppError(400, "Unsupported email type", "VALIDATION_ERROR");
      }
      if (
        (type === "account_activation" &&
          staffRole !== "BTC" &&
          staffRole !== "REFEREE") ||
        (type !== "account_activation" && staffRole !== undefined)
      ) {
        throw new AppError(400, "Invalid account role", "VALIDATION_ERROR");
      }
      if (
        email.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !/^[a-f0-9]{64}$/i.test(token)
      ) {
        throw new AppError(400, "Invalid email request", "VALIDATION_ERROR");
      }

      await this.emailDeliveryService.sendAccountEmail(
        type,
        email,
        token,
        type === "account_activation" ? staffRole : undefined,
      );
      res.status(202).json({ status: "accepted" });
    } catch (error) {
      next(error);
    }
  }
}

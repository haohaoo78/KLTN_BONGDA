import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";
import type { NotificationService } from "../services/notificationService";
import type { NotificationType } from "../models/notification";

const notificationTypes: NotificationType[] = ["TEAM_MEMBERSHIP", "TOURNAMENT_INVITATION", "TOURNAMENT_REGISTRATION", "SYSTEM"];

export class InternalNotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, type, title, body, data } = req.body ?? {};
      const idempotencyKey = req.body?.idempotencyKey;
      if (
        typeof userId !== "string" ||
        typeof type !== "string" ||
        !notificationTypes.includes(type as NotificationType) ||
        typeof title !== "string" ||
        !title.trim() ||
        typeof body !== "string" ||
        !body.trim()
      ) {
        throw new AppError(400, "A valid userId, type, title, and body are required", "VALIDATION_ERROR");
      }
      if (
        data !== undefined &&
        (typeof data !== "object" || data === null || Array.isArray(data))
      ) {
        throw new AppError(400, "data must be an object", "VALIDATION_ERROR");
      }
      if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 255)) {
        throw new AppError(400, "idempotencyKey must be a non-empty string of at most 255 characters", "VALIDATION_ERROR");
      }
      const notification = await this.notificationService.sendNotification({
        userId,
        type: type as NotificationType,
        title: title.trim().slice(0, 255),
        body: body.trim(),
        ...(data ? { data: data as Record<string, unknown> } : {}),
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      res.status(201).json({ notification });
    } catch (error) {
      next(error);
    }
  }
}

import { Request, Response, NextFunction } from "express";
import { NotificationService } from "../services/notificationService";
import { AppError } from "../lib/errors";
import type { NotificationCreateInput } from "../models/notification";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";

export const notificationController = {
  notificationService: null as NotificationService | null,

  setNotificationService(service: NotificationService) {
    this.notificationService = service;
  },

  async listNotifications(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.notificationService) {
        throw new AppError(500, "Notification service not initialized", "SERVICE_ERROR");
      }

      const userId = (req as AuthenticatedRequest).userId ?? "";

      if (!userId) {
        throw new AppError(401, "User ID required", "UNAUTHORIZED");
      }

      const limitRaw = Number(req.query.limit ?? 20);
      const offsetRaw = Number(req.query.offset ?? 0);
      const limit = Number.isFinite(limitRaw)
        ? Math.min(Math.max(1, limitRaw), 100)
        : 20;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
      const readParam = req.query.read;
      if (readParam !== undefined && readParam !== "true" && readParam !== "false") {
        throw new AppError(400, "read must be true or false", "VALIDATION_ERROR");
      }
      const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 200) : "";
      const from = typeof req.query.from === "string" ? req.query.from : undefined;
      const to = typeof req.query.to === "string" ? req.query.to : undefined;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;
      const isValidDate = (value: string) => {
        if (!datePattern.test(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      };
      if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
        throw new AppError(400, "from and to must be valid YYYY-MM-DD dates", "VALIDATION_ERROR");
      }
      if (from && to && from > to) {
        throw new AppError(400, "from must not be after to", "VALIDATION_ERROR");
      }

      const result = await this.notificationService.listUserNotifications(
        userId,
        limit,
        offset,
        {
          read: readParam === undefined ? undefined : readParam === "true",
          search,
          from,
          to,
        },
      );

      res.json({
        notifications: result.items,
        pagination: { limit, offset, total: result.total },
      });
    } catch (err) {
      next(err);
    }
  },

  async getNotification(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!this.notificationService) {
        throw new AppError(500, "Notification service not initialized", "SERVICE_ERROR");
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        throw new AppError(400, "Invalid notification ID", "VALIDATION_ERROR");
      }

      const notification = await this.notificationService.getNotification(id, req.userId ?? "");

      if (!notification) {
        throw new AppError(404, "Notification not found", "NOT_FOUND");
      }

      res.json({ notification });
    } catch (err) {
      next(err);
    }
  },

  async markAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!this.notificationService) {
        throw new AppError(500, "Notification service not initialized", "SERVICE_ERROR");
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        throw new AppError(400, "Invalid notification ID", "VALIDATION_ERROR");
      }

      const notification = await this.notificationService.markAsRead(id, req.userId ?? "");

      if (!notification) {
        throw new AppError(404, "Notification not found", "NOT_FOUND");
      }

      res.json({ notification });
    } catch (err) {
      next(err);
    }
  },

  async markAllAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.notificationService) {
        throw new AppError(500, "Notification service not initialized", "SERVICE_ERROR");
      }

      const userId = (req as AuthenticatedRequest).userId ?? "";

      if (!userId) {
        throw new AppError(401, "User ID required", "UNAUTHORIZED");
      }

      await this.notificationService.markAllAsRead(userId);

      res.json({ message: "All notifications marked as read" });
    } catch (err) {
      next(err);
    }
  },

  async deleteNotification(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!this.notificationService) {
        throw new AppError(500, "Notification service not initialized", "SERVICE_ERROR");
      }

      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        throw new AppError(400, "Invalid notification ID", "VALIDATION_ERROR");
      }

      const deleted = await this.notificationService.deleteNotification(id, req.userId ?? "");
      if (!deleted) {
        throw new AppError(404, "Notification not found", "NOT_FOUND");
      }

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async getUnreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      if (!this.notificationService) {
        throw new AppError(500, "Notification service not initialized", "SERVICE_ERROR");
      }

      const userId = (req as AuthenticatedRequest).userId ?? "";

      if (!userId) {
        throw new AppError(401, "User ID required", "UNAUTHORIZED");
      }

      const count = await this.notificationService.getUnreadCount(userId);

      res.json({ count });
    } catch (err) {
      next(err);
    }
  },

  async sendNotification(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (!this.notificationService) {
        throw new AppError(500, "Notification service not initialized", "SERVICE_ERROR");
      }

      const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
      const type = typeof req.body?.type === "string" ? req.body.type : "";
      const title = typeof req.body?.title === "string" ? req.body.title : "";
      const body = typeof req.body?.body === "string" ? req.body.body : "";
      const data = typeof req.body?.data === "object" ? req.body.data : {};

      if (!userId || !type || !title || !body) {
        throw new AppError(400, "userId, type, title, and body are required", "VALIDATION_ERROR");
      }

      const notification = await this.notificationService.sendNotification({
        userId,
        type,
        title,
        body,
        data,
      });

      res.status(201).json({ notification });
    } catch (err) {
      next(err);
    }
  },
};

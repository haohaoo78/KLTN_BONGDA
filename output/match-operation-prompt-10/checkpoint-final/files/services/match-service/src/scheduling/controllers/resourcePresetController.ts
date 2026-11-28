import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../middleware/gatewayUser";
import { config } from "../../config";
import { AppError } from "../../lib/errors";
import { getScheduleResourcePreset, saveScheduleResourcePreset } from "../repositories/resourcePresetRepository";

function assertTestApiEnabled(): void {
  if (config.nodeEnv === "production" || !config.schedulingTestApiEnabled) {
    throw new AppError(404, "Not found", "NOT_FOUND");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const resourcePresetController = {
  async get(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertTestApiEnabled();
      if (!req.userId) throw new AppError(401, "Cần đăng nhập tài khoản BTC.", "UNAUTHENTICATED");
      const preset = await getScheduleResourcePreset(req.userId);
      res.json({ state: preset?.state ?? null, version: preset?.version ?? 0, updatedAt: preset?.updatedAt ?? null });
    } catch (error) { next(error); }
  },

  async save(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      assertTestApiEnabled();
      if (!req.userId) throw new AppError(401, "Cần đăng nhập tài khoản BTC.", "UNAUTHENTICATED");
      const state = req.body?.state;
      const expectedVersion = Number(req.body?.expectedVersion);
      if (!isObject(state) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0
        || !Array.isArray(state.venues) || !Array.isArray(state.locations) || !Array.isArray(state.slots)
        || state.venues.length > 128 || state.locations.length > 128 || state.slots.length > 96
        || Buffer.byteLength(JSON.stringify(state), "utf8") > 750_000) {
        throw new AppError(400, "Cấu hình lưu dùng lại không hợp lệ hoặc vượt giới hạn.", "INVALID_SCHEDULE_RESOURCE_PRESET");
      }
      const saved = await saveScheduleResourcePreset(req.userId, state, expectedVersion);
      if (!saved) throw new AppError(409, "Cấu hình dùng lại vừa được cập nhật ở nơi khác. Tải lại rồi thử lại.", "SCHEDULE_RESOURCE_PRESET_VERSION_CONFLICT");
      res.json(saved);
    } catch (error) { next(error); }
  },
};

import { AppError } from "../lib/errors";

const drawReadyStatuses = new Set(["ROSTER_LOCKED"]);

export function assertDrawStageReady(status: string): void {
  if (!drawReadyStatuses.has(status)) {
    throw new AppError(
      409,
      "Chỉ được chia hoặc chỉnh bản chia khi roster đã chốt và giải chưa chuyển sang chuẩn bị lịch",
      "DRAW_STAGE_NOT_READY",
    );
  }
}

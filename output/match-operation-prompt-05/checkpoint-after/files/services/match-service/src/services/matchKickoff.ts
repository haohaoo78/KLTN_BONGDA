import { AppError } from "../lib/errors";

export function assertKickoffReached(scheduledDate: string | null, now = Date.now()): void {
  if (!scheduledDate) {
    throw new AppError(409, "Cần giờ bắt đầu trong lịch chính thức trước khi bắt đầu trận.", "MATCH_SCHEDULE_REQUIRED");
  }

  const kickoff = Date.parse(scheduledDate);
  if (!Number.isFinite(kickoff)) {
    throw new AppError(409, "Giờ bắt đầu trong lịch không hợp lệ.", "MATCH_SCHEDULE_INVALID");
  }

  if (kickoff > now) {
    throw new AppError(409, "Chưa đến giờ bắt đầu trận theo lịch chính thức.", "MATCH_KICKOFF_NOT_REACHED");
  }
}

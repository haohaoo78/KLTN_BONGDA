import type { MatchClockAction, MatchClockPhase, MatchStatus } from "../models/match";
import { AppError } from "../lib/errors";

export function transitionMatchClock(
  phase: MatchClockPhase,
  isRunning: boolean,
  action: MatchClockAction,
): { phase: MatchClockPhase; isRunning: boolean; matchStatus?: MatchStatus } {
  if (action === "START_MATCH" && phase === "NOT_STARTED" && !isRunning) {
    return { phase: "FIRST_HALF", isRunning: true, matchStatus: "IN_PROGRESS" };
  }
  if (action === "PAUSE" && isRunning) return { phase, isRunning: false };
  if (action === "RESUME" && !isRunning && ["FIRST_HALF", "SECOND_HALF", "EXTRA_TIME_FIRST_HALF", "EXTRA_TIME_SECOND_HALF", "PENALTIES"].includes(phase)) {
    return { phase, isRunning: true };
  }
  if (action === "END_PERIOD" && isRunning) {
    const next: Partial<Record<MatchClockPhase, MatchClockPhase>> = {
      FIRST_HALF: "HALF_TIME",
      SECOND_HALF: "REGULATION_COMPLETE",
      EXTRA_TIME_FIRST_HALF: "EXTRA_TIME_HALF_TIME",
      EXTRA_TIME_SECOND_HALF: "EXTRA_TIME_COMPLETE",
      PENALTIES: "ENDED",
    };
    const nextPhase = next[phase];
    if (nextPhase) return { phase: nextPhase, isRunning: false, ...(nextPhase === "ENDED" ? { matchStatus: "FINISHED" as const } : {}) };
  }
  if (action === "START_NEXT_PERIOD" && !isRunning) {
    if (phase === "HALF_TIME") return { phase: "SECOND_HALF", isRunning: true };
    if (phase === "EXTRA_TIME_HALF_TIME") return { phase: "EXTRA_TIME_SECOND_HALF", isRunning: true };
  }
  if (action === "START_EXTRA_TIME" && !isRunning && phase === "REGULATION_COMPLETE") {
    return { phase: "EXTRA_TIME_FIRST_HALF", isRunning: true };
  }
  if (action === "START_PENALTIES" && !isRunning && (phase === "REGULATION_COMPLETE" || phase === "EXTRA_TIME_COMPLETE")) {
    return { phase: "PENALTIES", isRunning: true };
  }
  if (action === "END_MATCH" && !isRunning && (phase === "REGULATION_COMPLETE" || phase === "EXTRA_TIME_COMPLETE")) {
    return { phase: "ENDED", isRunning: false, matchStatus: "FINISHED" };
  }
  throw new AppError(409, `Không thể thực hiện ${action} khi trận ở hiệp ${phase}${isRunning ? " (đang chạy)" : " (đang dừng)"}.`, "INVALID_CLOCK_TRANSITION");
}

export function assertMatchStartPrerequisites(input: {
  homeTeamId: string | null;
  awayTeamId: string | null;
  hasPublishedSchedule: boolean;
  publishedOfficialCount: number;
  finalAuthorityCount: number;
}): void {
  if (!input.homeTeamId || !input.awayTeamId || input.homeTeamId === input.awayTeamId) {
    throw new AppError(409, "Chưa xác định đủ hai đội hợp lệ cho trận đấu.", "MATCH_TEAMS_UNRESOLVED");
  }
  if (!input.hasPublishedSchedule) {
    throw new AppError(409, "Chỉ bắt đầu trận sau khi lịch thi đấu được công bố chính thức.", "PUBLISHED_SCHEDULE_REQUIRED");
  }
  if (input.publishedOfficialCount < 1 || input.finalAuthorityCount !== 1) {
    throw new AppError(409, "Trận chưa có phân công trọng tài đã công bố với người có thẩm quyền xác nhận kết quả.", "PUBLISHED_REFEREE_ASSIGNMENT_REQUIRED");
  }
}

export function accrueClock(
  elapsedSeconds: number,
  totalElapsedSeconds: number,
  startedAt: Date | null,
  now: Date,
): { elapsedSeconds: number; totalElapsedSeconds: number } {
  if (!startedAt) return { elapsedSeconds, totalElapsedSeconds };
  const delta = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  return { elapsedSeconds: elapsedSeconds + delta, totalElapsedSeconds: totalElapsedSeconds + delta };
}

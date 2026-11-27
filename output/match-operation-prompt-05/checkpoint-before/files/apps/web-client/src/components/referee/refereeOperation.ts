import type { MatchClockAction, MatchEvent } from "../../api/competition";
import type { RefereeMatchContext } from "../../api/refereePortal";

export function scoreFromEvents(events: MatchEvent[], homeId: string | null, awayId: string | null, throughMinute = Infinity) {
  const score = { home: 0, away: 0 };
  for (const event of events) {
    if ((event.minute ?? Infinity) > throughMinute || !["GOAL", "PENALTY_GOAL", "OWN_GOAL"].includes(event.eventType)) continue;
    if (event.teamId !== homeId && event.teamId !== awayId) continue;
    const home = event.teamId === homeId;
    if (home !== (event.eventType === "OWN_GOAL")) score.home++; else score.away++;
  }
  return score;
}
export function clockActions(context: RefereeMatchContext, now = Date.now()): MatchClockAction[] {
  if (context.readiness && (!context.readiness.crewPublished || context.readiness.tournamentStatus !== "IN_PROGRESS" || context.clock.phase === "NOT_STARTED" && !context.readiness.canStart)) return [];
  if (!context.assignment.capabilities.includes("FINALIZE") || !context.assignment.isFinalAuthority || ["CANCELLED", "POSTPONED", "VERIFIED", "LOCKED"].includes(context.match.status)) return [];
  const { phase, isRunning } = context.clock;
  if (phase === "NOT_STARTED") return context.match.status === "LINEUP_CONFIRMED" && Date.parse(context.schedule.scheduledDate) <= now ? ["START_MATCH"] : [];
  if (isRunning) return ["PAUSE", "END_PERIOD"];
  if (phase === "HALF_TIME" || phase === "EXTRA_TIME_HALF_TIME") return ["START_NEXT_PERIOD"];
  if (["FIRST_HALF", "SECOND_HALF", "EXTRA_TIME_FIRST_HALF", "EXTRA_TIME_SECOND_HALF", "PENALTIES"].includes(phase)) return ["RESUME"];
  if (["REGULATION_COMPLETE", "EXTRA_TIME_COMPLETE"].includes(phase)) {
    const actions: MatchClockAction[] = ["END_MATCH"];
    if (context.match.stage === "KNOCKOUT") {
      if (phase === "REGULATION_COMPLETE" && context.rules?.knockoutDecisionMethod === "EXTRA_TIME_THEN_PENALTIES") actions.push("START_EXTRA_TIME");
      if (phase === "EXTRA_TIME_COMPLETE" || context.rules?.knockoutDecisionMethod === "PENALTIES_ONLY") actions.push("START_PENALTIES");
    }
    return actions;
  }
  return [];
}
export const clockActionLabels: Record<MatchClockAction, string> = { START_MATCH: "Bắt đầu trận", PAUSE: "Tạm dừng đồng hồ", RESUME: "Tiếp tục trận", END_PERIOD: "Kết thúc hiệp", START_NEXT_PERIOD: "Bắt đầu hiệp tiếp theo", START_EXTRA_TIME: "Bắt đầu hiệp phụ", START_PENALTIES: "Bắt đầu luân lưu", END_MATCH: "Kết thúc trận" };
export const defaultOperationStage = (status: string) => ["FINISHED", "VERIFIED", "LOCKED"].includes(status) ? "post" : status === "IN_PROGRESS" ? "live" : "pre";
export const canRecordEvents = (context: RefereeMatchContext) => context.assignment.capabilities.includes("RECORD_EVENT") && context.match.status === "IN_PROGRESS";
export const clockSeconds = (elapsed: number) => `${String(Math.floor(elapsed / 60)).padStart(2,"0")}:${String(Math.floor(elapsed % 60)).padStart(2,"0")}`;
export const eventMinuteForClock = (totalElapsedSeconds: number, runningDelta = 0) => Math.min(120, Math.floor(Math.max(0, totalElapsedSeconds + runningDelta) / 60));
export function refereeError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const labels: Record<string,string> = { CLOCK_VERSION_CONFLICT: "Đồng hồ đã được cập nhật trên thiết bị khác. Hãy tải lại trạng thái mới.", MATCH_KICKOFF_NOT_REACHED: "Chưa đến giờ bắt đầu trận theo lịch chính thức.", MATCH_NOT_READY: "Cần xác nhận đội hình và điều kiện thi đấu trước khi bắt đầu.", MATCH_NOT_FINISHED: "Chỉ hoàn tất biên bản sau khi kết thúc trận.", MATCH_RESULT_REQUIRED: "Cần lưu nháp kết quả trước khi gửi biên bản.", REPORT_EXISTS: "Biên bản đã được gửi. Hãy tải lại để xem trạng thái mới.", FINAL_AUTHORITY_REQUIRED: "Chỉ trọng tài được giao thẩm quyền cuối cùng mới được thực hiện thao tác này.", EVENT_PERMISSION_REQUIRED: "Nhiệm vụ của bạn không có quyền ghi nhận diễn biến.", EVENT_EDIT_PERMISSION_REQUIRED: "Nhiệm vụ của bạn không có quyền đính chính diễn biến.", INVALID_CLOCK_TRANSITION: "Thao tác không phù hợp với hiệp đấu hiện tại. Hãy tải lại đồng hồ.", LINEUP_EMPTY: "Đội bóng chưa gửi đội hình thi đấu.", MATCH_LINEUP_NOT_CONFIRMED: "Hai đội cần xác nhận đầy đủ đội hình trước khi bắt đầu.", MATCH_NOT_IN_PROGRESS: "Chỉ ghi nhận diễn biến khi trận đang thi đấu.", MATCH_RESULT_LOCKED: "Kết quả đã được xác nhận. Hãy sử dụng yêu cầu đính chính.", INVALID_MATCH_STATUS: "Trạng thái trận không cho phép thực hiện thao tác này." };
  return labels[code] ?? (error instanceof Error ? error.message : "Không thể hoàn tất thao tác. Vui lòng thử lại.");
}

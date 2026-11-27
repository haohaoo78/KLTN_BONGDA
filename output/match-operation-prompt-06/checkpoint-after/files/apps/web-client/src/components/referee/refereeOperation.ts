import type { MatchClockAction, MatchEvent } from "../../api/competition";
import type { RefereeMatchContext } from "../../api/refereePortal";
import {PLAYING_CLOCK_PHASES,periodTiming,type MatchClockPhase} from "../../../../../packages/shared/src/matchTiming";

export function scoreFromEvents(events: MatchEvent[], homeId: string | null, awayId: string | null, phase?:MatchClockPhase) {
  const score = { home: 0, away: 0 };
  for (const event of events) {
    if (event.phase==="PENALTIES"||phase&&event.phase!==phase||!["GOAL", "PENALTY_GOAL", "OWN_GOAL"].includes(event.eventType)) continue;
    if (event.teamId !== homeId && event.teamId !== awayId) continue;
    const home = event.teamId === homeId;
    if (home !== (event.eventType === "OWN_GOAL")) score.home++; else score.away++;
  }
  return score;
}
export function clockActions(context: RefereeMatchContext, now = Date.now()): MatchClockAction[] {
  if (context.readiness && (!context.readiness.crewPublished || context.readiness.tournamentStatus !== "IN_PROGRESS" || context.clock.phase === "NOT_STARTED" && !context.readiness.canStart)) return [];
  if (!context.assignment.capabilities.includes("FINALIZE") || !context.assignment.isFinalAuthority || ["CANCELLED", "POSTPONED", "VERIFIED", "LOCKED"].includes(context.match.status)) return [];
  const { phase, isRunning } = context.clock,rules=context.operationRules;
  if(!rules||rules.missing.CLOCK.length||context.clock.reviewRequired||context.clock.interruption&&["POSTPONED","ABANDONED","CANCELLED"].includes(context.clock.interruption))return [];
  if (phase === "NOT_STARTED") return context.match.status === "LINEUP_CONFIRMED" && Date.parse(context.schedule.scheduledDate) <= now ? ["START_MATCH"] : [];
  if(context.match.status!=="IN_PROGRESS")return [];
  const timing=periodTiming(phase,Number(rules.rules.values.periodMinutes),rules.extraTimeMinutes);
  const canEnd=timing!==null&&context.clock.elapsedSeconds>=timing.nominalSeconds+(context.clock.addedTimeSeconds??0);
  if (isRunning&&PLAYING_CLOCK_PHASES.includes(phase)) return [...(rules.rules.values.clockMode==="STOPPED"?["PAUSE" as const]:[]),"SUSPEND_PLAY",...(rules.rules.values.addedTime==="REFEREE_ALLOWANCE"?["DECLARE_ADDED_TIME" as const]:[]),...(canEnd?["END_PERIOD" as const]:[])];
  if (phase === "HALF_TIME" || phase === "EXTRA_TIME_HALF_TIME") return ["START_NEXT_PERIOD"];
  if (PLAYING_CLOCK_PHASES.includes(phase)) return context.clock.interruption?["RESUME",...(canEnd&&context.clock.interruption==="CLOCK_STOP"?["END_PERIOD" as const]:[])]:[];
  if (["REGULATION_COMPLETE", "EXTRA_TIME_COMPLETE"].includes(phase)) {
    const score=scoreFromEvents(context.events,context.home.id,context.away.id),tied=score.home===score.away;
    const actions: MatchClockAction[] = !tied||rules.decisionMethod==="ALLOW_DRAW"?["END_MATCH"]:[];
    if(tied&&rules.decisionMethod==="EXTRA_TIME_THEN_PENALTIES"&&phase==="REGULATION_COMPLETE")actions.push("START_EXTRA_TIME");
    if(tied&&(phase==="EXTRA_TIME_COMPLETE"&&rules.decisionMethod==="EXTRA_TIME_THEN_PENALTIES"||rules.decisionMethod==="PENALTIES_ONLY"))actions.push("START_PENALTIES");
    return actions;
  }
  if(phase==="PENALTIES"&&context.result?.homePenaltyScore!=null&&context.result?.awayPenaltyScore!=null&&context.result.homePenaltyScore!==context.result.awayPenaltyScore)return ["END_PERIOD"];
  return [];
}
export const clockActionLabels: Record<MatchClockAction, string> = { START_MATCH: "Bắt đầu trận", PAUSE: "Dừng tính giờ", SUSPEND_PLAY:"Tạm dừng thi đấu",DECLARE_ADDED_TIME:"Công bố bù giờ",RESUME: "Tiếp tục trận", END_PERIOD: "Kết thúc hiệp", START_NEXT_PERIOD: "Bắt đầu hiệp tiếp theo", START_EXTRA_TIME: "Bắt đầu hiệp phụ", START_PENALTIES: "Bắt đầu luân lưu", END_MATCH: "Kết thúc trận" };
export const defaultOperationStage = (status: string) => ["FINISHED", "VERIFIED", "LOCKED"].includes(status) ? "post" : status === "IN_PROGRESS" ? "live" : "pre";
export const canRecordAdministrativeEvent=(context:RefereeMatchContext)=>context.assignment.capabilities.includes("RECORD_EVENT")&&["LINEUP_CONFIRMED","IN_PROGRESS","FINISHED"].includes(context.match.status)&&!context.clock.reviewRequired&&(!context.report||context.report.status==="REVISION_REQUIRED")&&(!context.readiness||context.readiness.crewPublished&&["PREPARING","IN_PROGRESS"].includes(context.readiness.tournamentStatus));
export const canRecordEvents = (context: RefereeMatchContext) => context.assignment.capabilities.includes("RECORD_EVENT") && context.match.status === "IN_PROGRESS"&&!context.clock.reviewRequired&&PLAYING_CLOCK_PHASES.includes(context.clock.phase)&&(context.clock.isRunning||context.operationRules?.rules.values.clockMode==="STOPPED"&&context.clock.interruption==="CLOCK_STOP")&&(!context.readiness||context.readiness.crewPublished&&context.readiness.tournamentStatus==="IN_PROGRESS");
export const clockSeconds = (elapsed: number) => `${String(Math.floor(elapsed / 60)).padStart(2,"0")}:${String(Math.floor(elapsed % 60)).padStart(2,"0")}`;
export const eventMinuteForClock = (elapsedSeconds: number, runningDelta = 0) => Math.floor(Math.max(0, elapsedSeconds + runningDelta) / 60);
export function currentEventTiming(context:RefereeMatchContext,elapsedSeconds:number){const t=periodTiming(context.clock.phase,Number(context.operationRules?.rules.values.periodMinutes),context.operationRules?.extraTimeMinutes??null);return {phase:context.clock.phase,periodElapsedSeconds:Math.floor(elapsedSeconds),minute:(t?.baseMinute??0)+eventMinuteForClock(elapsedSeconds),expectedClockVersion:context.clock.version};}
export function refereeError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const labels: Record<string,string> = { CLOCK_VERSION_CONFLICT: "Đồng hồ đã được cập nhật trên thiết bị khác. Hãy tải lại trạng thái mới.", MATCH_KICKOFF_NOT_REACHED: "Chưa đến giờ bắt đầu trận theo lịch chính thức.", MATCH_NOT_READY: "Cần xác nhận đội hình và điều kiện thi đấu trước khi bắt đầu.", MATCH_NOT_FINISHED: "Chỉ hoàn tất biên bản sau khi kết thúc trận.", MATCH_RESULT_REQUIRED: "Cần lưu nháp kết quả trước khi gửi biên bản.", REPORT_EXISTS: "Biên bản đã được gửi. Hãy tải lại để xem trạng thái mới.", FINAL_AUTHORITY_REQUIRED: "Chỉ trọng tài được giao thẩm quyền cuối cùng mới được thực hiện thao tác này.", EVENT_PERMISSION_REQUIRED: "Nhiệm vụ của bạn không có quyền ghi nhận diễn biến.", EVENT_EDIT_PERMISSION_REQUIRED: "Nhiệm vụ của bạn không có quyền đính chính diễn biến.", INVALID_CLOCK_TRANSITION: "Thao tác không phù hợp với hiệp đấu hiện tại. Hãy tải lại đồng hồ.", LINEUP_EMPTY: "Đội bóng chưa gửi đội hình thi đấu.", MATCH_LINEUP_NOT_CONFIRMED: "Hai đội cần xác nhận đầy đủ đội hình trước khi bắt đầu.", MATCH_NOT_IN_PROGRESS: "Chỉ ghi nhận diễn biến khi trận đang thi đấu.", MATCH_RESULT_LOCKED: "Kết quả đã được xác nhận. Hãy sử dụng yêu cầu đính chính.", INVALID_MATCH_STATUS: "Trạng thái trận không cho phép thực hiện thao tác này." };
  return labels[code] ?? (error instanceof Error ? error.message : "Không thể hoàn tất thao tác. Vui lòng thử lại.");
}

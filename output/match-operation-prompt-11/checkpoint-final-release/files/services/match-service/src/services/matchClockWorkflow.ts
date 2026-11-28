import type { MatchClockAction, MatchClockPhase, MatchStatus } from "../models/match";
import { AppError } from "../lib/errors";
import { PLAYING_CLOCK_PHASES,periodTiming,type EffectiveMatchRules,type MatchClockActionOptions,type ClockInterruption } from "@sfl/shared";

export function transitionMatchClock(
  phase: MatchClockPhase,
  isRunning: boolean,
  action: MatchClockAction,
): { phase: MatchClockPhase; isRunning: boolean; matchStatus?: MatchStatus } {
  if (action === "START_MATCH" && phase === "NOT_STARTED" && !isRunning) {
    return { phase: "FIRST_HALF", isRunning: true, matchStatus: "IN_PROGRESS" };
  }
  if ((action === "PAUSE"||action==="SUSPEND_PLAY") && isRunning && PLAYING_CLOCK_PHASES.includes(phase)) return { phase, isRunning: false };
  if (action === "DECLARE_ADDED_TIME" && isRunning && PLAYING_CLOCK_PHASES.includes(phase)) return {phase,isRunning};
  if (action === "RESUME" && !isRunning && PLAYING_CLOCK_PHASES.includes(phase)) {
    return { phase, isRunning: true };
  }
  if (action === "END_PERIOD" && (PLAYING_CLOCK_PHASES.includes(phase)||phase==="PENALTIES")) {
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
    return { phase: "PENALTIES", isRunning: false };
  }
  if (action === "END_MATCH" && !isRunning && (phase === "REGULATION_COMPLETE" || phase === "EXTRA_TIME_COMPLETE")) {
    return { phase: "ENDED", isRunning: false, matchStatus: "FINISHED" };
  }
  throw new AppError(409, `Không thể thực hiện ${action} khi trận ở hiệp ${phase}${isRunning ? " (đang chạy)" : " (đang dừng)"}.`, "INVALID_CLOCK_TRANSITION");
}

/** Domain guards supplement the existing phase transitions, using the pinned rules. */
export function assertClockTimingAction(input:{status:string;phase:MatchClockPhase;isRunning:boolean;elapsedSeconds:number;addedTimeSeconds:number;interruption:ClockInterruption|null;rules:EffectiveMatchRules;action:MatchClockAction;options:MatchClockActionOptions;score:{home:number;away:number};shootoutScore?:{home:number;away:number}|null}){
 const {status,phase,action,rules,options}=input;
 if(action==="START_MATCH"?status!=="LINEUP_CONFIRMED":status!=="IN_PROGRESS")throw new AppError(409,"Trạng thái trận không cho phép điều khiển đồng hồ.","MATCH_CLOCK_STATE_INVALID");
 if(input.interruption&&["POSTPONED","ABANDONED","CANCELLED"].includes(input.interruption))throw new AppError(409,"Cần quyết định hợp lệ của BTC trước khi đá tiếp; không dùng Resume đồng hồ.","MATCH_CONTINUATION_DECISION_REQUIRED");
 if(input.interruption==="PLAY_SUSPENDED"&&action!=="RESUME")throw new AppError(409,"Trận đang tạm dừng thi đấu. Chỉ tiếp tục theo thẩm quyền hoặc chuyển BTC xử lý.","MATCH_PLAY_SUSPENDED");
 if(action==="PAUSE"&&rules.rules.values.clockMode!=="STOPPED")throw new AppError(409,"Bộ luật dùng đồng hồ chạy liên tục; gián đoạn thông thường được xử lý bằng bù giờ. Tạm dừng thi đấu phải có lý do riêng.","CLOCK_STOP_NOT_ALLOWED");
 if(action==="SUSPEND_PLAY"&&(!options.reason?.trim()||options.reason.trim().length>2000))throw new AppError(400,"Cần nêu lý do tạm dừng thi đấu (tối đa 2000 ký tự).","CLOCK_REASON_REQUIRED");
 if(action==="RESUME"&&!input.interruption)throw new AppError(409,"Không có lần dừng hợp lệ để tiếp tục.","INVALID_CLOCK_TRANSITION");
 const period=periodTiming(phase,Number(rules.rules.values.periodMinutes),rules.extraTimeMinutes);
 if(action==="DECLARE_ADDED_TIME"){
  if(rules.rules.values.addedTime!=="REFEREE_ALLOWANCE")throw new AppError(409,"Bộ luật không áp dụng bù giờ thông thường.","ADDED_TIME_NOT_ALLOWED");
  if(!Number.isInteger(options.addedTimeSeconds)||Number(options.addedTimeSeconds)<0||Number(options.addedTimeSeconds)>2147483647)throw new AppError(400,"Thời gian bù giờ phải là số giây không âm.","ADDED_TIME_INVALID");
  if(Number(options.addedTimeSeconds)<input.addedTimeSeconds)throw new AppError(409,"Không được giảm mức bù giờ tối thiểu đã công bố trong hiệp này.","ADDED_TIME_CANNOT_DECREASE");
 }
 if(action==="END_PERIOD"&&period&&input.elapsedSeconds<period.nominalSeconds+input.addedTimeSeconds)throw new AppError(409,"Chưa đủ thời lượng hiệp và bù giờ tối thiểu đã công bố. Nếu không thể tiếp tục, ghi nhận tạm dừng/ngoại lệ.","CLOCK_PERIOD_NOT_COMPLETE");
 const tied=input.score.home===input.score.away;
 if(["START_EXTRA_TIME","START_PENALTIES"].includes(action)&&!tied)throw new AppError(409,"Chỉ chuyển sang giai đoạn phân định khi tỷ số đang hòa.","MATCH_NOT_TIED");
 if(action==="END_MATCH"&&tied&&rules.decisionMethod!=="ALLOW_DRAW")throw new AppError(409,"Trận cần phân định đội thắng theo điều lệ; chưa được kết thúc ở giai đoạn này.","MATCH_WINNER_REQUIRED");
 if(action==="END_PERIOD"&&phase==="PENALTIES"&&(!input.shootoutScore||input.shootoutScore.home===input.shootoutScore.away))throw new AppError(409,"Loạt sút chưa xác định đội thắng theo từng lượt hợp lệ.","SHOOTOUT_RESULT_REQUIRED");
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

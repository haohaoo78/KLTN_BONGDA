import {periodTiming,PLAYING_CLOCK_PHASES,type EffectiveMatchRules,type MatchClockPhase} from "@sfl/shared";
import type {MatchEventCreateInput} from "../models/match";
import {AppError} from "../lib/errors";
export function deriveMatchEventTiming(input:MatchEventCreateInput,clock:{phase:MatchClockPhase;version:number;elapsedSeconds:number;timing_model_version?:number},rules:EffectiveMatchRules){
 if(clock.timing_model_version!==1)throw new AppError(409,"Cần kiểm tra dữ liệu clock cũ trước khi ghi thời gian sự kiện.","CLOCK_MODEL_REVIEW_REQUIRED");
 if(!PLAYING_CLOCK_PHASES.includes(clock.phase))throw new AppError(409,"Sự kiện thi đấu phải thuộc một hiệp đang diễn ra; luân lưu có quy trình phân định riêng.","EVENT_PHASE_INVALID");
 if(input.phase!=null&&input.phase!==clock.phase)throw new AppError(409,"Hiệp đấu đã đổi. Hãy tải trạng thái mới và mở lại biểu mẫu sự kiện.","EVENT_PHASE_CHANGED");
 if(input.expectedClockVersion!=null&&input.expectedClockVersion!==clock.version)throw new AppError(409,"Đồng hồ đã đổi. Hãy kiểm tra thời điểm trước khi gửi lại sự kiện.","CLOCK_VERSION_CONFLICT");
 const timing=periodTiming(clock.phase,Number(rules.rules.values.periodMinutes),rules.extraTimeMinutes);
 if(!timing)throw new AppError(409,"Chưa đủ quy tắc thời gian cho hiệp này.","MATCH_RULES_UNDEFINED");
 const currentMinute=timing.baseMinute+Math.floor(clock.elapsedSeconds/60);
 const seconds=input.periodElapsedSeconds??(input.minute==null||input.minute===currentMinute?clock.elapsedSeconds:(input.minute-timing.baseMinute)*60);
 if(!Number.isInteger(seconds)||seconds<0||seconds>clock.elapsedSeconds)throw new AppError(400,"Thời điểm phải nằm trong hiệp hiện tại và không vượt đồng hồ chính thức.","EVENT_TIME_INVALID");
 const minute=timing.baseMinute+Math.floor(seconds/60);
 if(input.minute!=null&&input.minute!==minute)throw new AppError(400,"Phút hiển thị không khớp thời điểm trong hiệp.","EVENT_TIME_INVALID");
 if(rules.rules.values.clockMode==="STOPPED"&&seconds>timing.nominalSeconds)throw new AppError(409,"Thời gian thi đấu thực tế của hiệp đã hết. Tình huống kéo dài theo luật cần xử lý đúng quy trình riêng.","EVENT_PERIOD_EXPIRED");
 return {phase:clock.phase,periodElapsedSeconds:seconds,minute,addedTimeSeconds:Math.max(0,seconds-timing.nominalSeconds)};
}

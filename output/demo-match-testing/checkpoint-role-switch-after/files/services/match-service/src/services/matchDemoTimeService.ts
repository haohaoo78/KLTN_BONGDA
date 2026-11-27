import { periodTiming } from "@sfl/shared";
import { getPool } from "../lib/db";
import { AppError } from "../lib/errors";
import { demoTimeAllowed,matchOperationNow } from "./matchOperationTime";
import { getEffectiveMatchRules } from "./matchOperationRulesService";
import { assertOperationActor } from "./matchOperationReadinessService";
import { withOperationScheduleLock } from "../scheduling/repositories/matchOperationReadinessRepository";
import { getTournamentScheduleSettings } from "../scheduling/services/schedulingService";
import { clockAccrued,type ClockRow } from "../repositories/matchClockRepository";
import { publishMatchUpdate } from "../realtime/matchRealtime";

const labels = {LINEUP:"Đến mốc lập đội hình",PREMATCH:"Đến mốc kiểm tra trước trận",KICKOFF:"Đến giờ bắt đầu trận",ADVANCE_MINUTE:"Tiến 1 phút",PERIOD_END:"Đến cuối hiệp hiện tại",HALF_TIME_END:"Đến hết thời gian nghỉ"};
export type DemoTimeAction = "ENABLE"|"DISABLE"|keyof typeof labels;

export async function demoTimeWorkspace(matchId: string) {
 const row=(await getPool().query("SELECT m.tournament_id,d.* FROM matches m LEFT JOIN match_demo_times d ON d.match_id=m.id WHERE m.id=$1",[matchId])).rows[0];
 if(!row)throw new AppError(404,"Không tìm thấy trận.","MATCH_NOT_FOUND");
 if(!demoTimeAllowed(row.tournament_id))return {available:false as const};
 return {available:true as const,enabled:row.enabled===true,revision:row.revision??0,used:row.revision!=null,
  effectiveNow:(await matchOperationNow(matchId)).toISOString(),realNow:new Date().toISOString(),actions:labels};
}

export async function changeDemoTime(matchId:string,actorId:string,input:{action:DemoTimeAction;expectedRevision:number;expectedClockVersion:number}) {
 if(!["ENABLE","DISABLE",...Object.keys(labels)].includes(input.action)||!Number.isInteger(input.expectedRevision)||input.expectedRevision<0||!Number.isInteger(input.expectedClockVersion)||input.expectedClockVersion<0)throw new AppError(400,"Cần thao tác và phiên bản hiện hành của phiên kiểm thử/đồng hồ.","DEMO_TIME_INVALID");
 return withOperationScheduleLock(matchId,async context=>{
  await assertOperationActor(context,actorId,"FINALIZE");
  const client=await getPool().connect();
  try {
   await client.query("BEGIN");
   const match=(await client.query("SELECT * FROM matches WHERE id=$1 FOR UPDATE",[matchId])).rows[0];
   if(!match||!demoTimeAllowed(match.tournament_id))throw new AppError(403,"Demo Mode chỉ dành cho giải được cho phép trong Development/Test.","DEMO_TIME_DISABLED");
   const tournament=await getTournamentScheduleSettings(match.tournament_id);
   if(!/^DEMO\s/i.test(tournament.name))throw new AppError(403,"Chỉ sử dụng Demo Mode trên giải có nhãn DEMO.","DEMO_TIME_NOT_DEMO_TOURNAMENT");
   const disableFinished=input.action==="DISABLE"&&["FINISHED","VERIFIED","LOCKED"].includes(match.status);
   if(!disableFinished&&(!["PREPARING","IN_PROGRESS"].includes(tournament.status)||!["SCHEDULED","LINEUP_CONFIRMED","IN_PROGRESS","FINISHED"].includes(match.status)))throw new AppError(409,"Trạng thái giải hoặc trận không cho phép kiểm thử thời gian.","DEMO_TIME_MATCH_LOCKED");
   const before=(await client.query("SELECT * FROM match_demo_times WHERE match_id=$1 FOR UPDATE",[matchId])).rows[0];
   const clock=(await client.query<ClockRow>("SELECT * FROM match_clock_states WHERE match_id=$1 FOR UPDATE",[matchId])).rows[0];
   if((before?.revision??0)!==input.expectedRevision||(clock?.version??0)!==input.expectedClockVersion)throw new AppError(409,"Thời gian hoặc đồng hồ đã đổi. Tải lại trước khi thao tác.","DEMO_TIME_VERSION_CONFLICT");
   const realNow=new Date(),now=await matchOperationNow(matchId,client);
   let enabled=before?.enabled===true,offset=Number(before?.offset_milliseconds??0),target=now.getTime();
   const phase=clock?.phase??"NOT_STARTED";
   if(input.action==="ENABLE"){
    if(enabled)throw new AppError(409,"Demo Mode đã bật.","DEMO_TIME_ALREADY_ENABLED");
    if(phase!=="NOT_STARTED"||match.status==="IN_PROGRESS"||match.status==="FINISHED")throw new AppError(409,"Chỉ bật Demo Mode trước khi trận bắt đầu.","DEMO_TIME_MATCH_STARTED");
    enabled=true;offset=0;
   } else if(input.action==="DISABLE") {
    if(!enabled)throw new AppError(409,"Demo Mode đã tắt.","DEMO_TIME_NOT_ENABLED");
    // No backwards jump in a live clock. Finished timestamps remain audited and labelled as simulated.
    if(phase!=="NOT_STARTED"&&phase!=="ENDED")throw new AppError(409,"Hãy hoàn tất trận kiểm thử trước khi tắt Demo Mode; không đưa đồng hồ đang thi đấu về quá khứ.","DEMO_TIME_MATCH_STARTED");
    enabled=false;offset=0;
   } else {
    if(!enabled)throw new AppError(409,"Cần bật Demo Mode cho trận này trước.","DEMO_TIME_NOT_ENABLED");
    if(match.status==="FINISHED")throw new AppError(409,"Trận đã kết thúc; không tiến thời gian thêm.","DEMO_TIME_MATCH_LOCKED");
    const rules=await getEffectiveMatchRules(matchId,client),v=rules.rules.values,kickoff=Date.parse(context.schedule.scheduledDate);
    if(["LINEUP","PREMATCH","KICKOFF"].includes(input.action)){
     if(phase!=="NOT_STARTED")throw new AppError(409,"Trận đã bắt đầu; chỉ tiến trong hiệp hiện tại.","DEMO_TIME_PHASE_INVALID");
     const deadlines=[v.lineupSubmissionMinutes,v.lineupEditMinutes].filter((n):n is number=>typeof n==="number");
     // One minute before the actual configured deadline is a test navigation point, never a new deadline.
     target=input.action==="LINEUP"?kickoff-(Math.max(0,...deadlines)+1)*60000:input.action==="PREMATCH"?kickoff-60000:kickoff;
    } else if(input.action==="HALF_TIME_END"){
     if(phase!=="HALF_TIME"||!clock?.phase_started_at||v.halfTimeMinutes==null)throw new AppError(409,"Chưa ở giờ nghỉ hoặc thiếu thời lượng nghỉ trong quy tắc.","DEMO_TIME_PHASE_INVALID");
     target=new Date(clock.phase_started_at).getTime()+Number(v.halfTimeMinutes)*60000;
    } else {
     const period=periodTiming(phase,Number(v.periodMinutes),rules.extraTimeMinutes);
     if(!clock?.is_running||!period)throw new AppError(409,"Chỉ tiến thời gian trong hiệp đang chạy với quy tắc đầy đủ.","DEMO_TIME_PHASE_INVALID");
     target=input.action==="ADVANCE_MINUTE"?now.getTime()+60000:now.getTime()+Math.max(0,(period.nominalSeconds+(clock.added_time_seconds??0))*1000-clockAccrued(clock,now).elapsedMilliseconds);
    }
    if(!Number.isFinite(target))throw new AppError(409,"Chưa có mốc thời gian hợp lệ.","DEMO_TIME_INVALID_TARGET");
    if(target<now.getTime()-1000)throw new AppError(409,"Đã qua mốc này. Demo Mode không quay lùi hoặc sửa lịch thi đấu.","DEMO_TIME_CANNOT_REWIND");
    offset=Math.max(offset,target-realNow.getTime());
   }
   const after=(await client.query(`INSERT INTO match_demo_times(match_id,enabled,offset_milliseconds,revision,updated_by) VALUES($1,$2,$3,1,$4)
    ON CONFLICT(match_id) DO UPDATE SET enabled=$2,offset_milliseconds=$3,revision=match_demo_times.revision+1,updated_by=$4,updated_at=NOW() RETURNING *`,[matchId,enabled,offset,actorId])).rows[0];
   // Invalidate forms opened before a time jump, without applying any clock transition.
   if(clock&&phase!=="NOT_STARTED")await client.query("UPDATE match_clock_states SET version=version+1 WHERE match_id=$1",[matchId]);
   await client.query("INSERT INTO match_demo_time_history(match_id,revision,action,actor_id,before_state,after_state,real_time,effective_time) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[matchId,after.revision,input.action,actorId,before??null,after,realNow,new Date(realNow.getTime()+(enabled?offset:0))]);
   await publishMatchUpdate(client,matchId,"match.demo-time.changed");
   await client.query("COMMIT");
  } catch(error){await client.query("ROLLBACK");throw error;} finally {client.release();}
  return demoTimeWorkspace(matchId);
 });
}

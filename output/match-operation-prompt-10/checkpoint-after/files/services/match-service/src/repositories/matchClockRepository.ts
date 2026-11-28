import type {PoolClient} from "pg";
import {PLAYING_CLOCK_PHASES,type ClockInterruption,type MatchClockActionOptions} from "@sfl/shared";
import {getPool} from "../lib/db";
import {AppError} from "../lib/errors";
import type {MatchClockAction,MatchClockPhase,MatchClockState} from "../models/match";
import {assertClockTimingAction,assertMatchStartPrerequisites,transitionMatchClock} from "../services/matchClockWorkflow";
import {publishMatchUpdate} from "../realtime/matchRealtime";
import {assertClockRuleAction,assertRuleOperation,getEffectiveMatchRules} from "../services/matchOperationRulesService";
import {withOperationScheduleLock,type OperationScheduleContext} from "../scheduling/repositories/matchOperationReadinessRepository";
import {assertOperationActor,getMatchOperationReadiness} from "../services/matchOperationReadinessService";
import {assertKickoffReached} from "../services/matchKickoff";
import {stageOutcome,saveFinishedOutcome} from './matchOutcomeRepository';
import {getShootoutWorkspace} from './matchShootoutRepository';
import { matchOperationNow } from "../services/matchOperationTime";

export type ClockRow={match_id:string;phase:MatchClockPhase;elapsed_seconds:number;total_elapsed_seconds:number;is_running:boolean;started_at:Date|null;updated_by:string|null;updated_at:Date;version:number;
 phase_started_at?:Date|null;actual_started_at?:Date|null;actual_ended_at?:Date|null;elapsed_milliseconds?:string|number|null;total_elapsed_milliseconds?:string|number|null;added_time_seconds?:number;interruption_kind?:ClockInterruption|null;interruption_reason?:string|null;timing_model_version?:number};
export function clockAccrued(row:ClockRow,now=new Date()){
 const delta=row.is_running&&row.started_at?Math.max(0,now.getTime()-new Date(row.started_at).getTime()):0;
 const elapsedMilliseconds=Number(row.elapsed_milliseconds??row.elapsed_seconds*1000)+delta,totalElapsedMilliseconds=Number(row.total_elapsed_milliseconds??row.total_elapsed_seconds*1000)+delta;
 return {elapsedMilliseconds,totalElapsedMilliseconds,elapsedSeconds:Math.floor(elapsedMilliseconds/1000),totalElapsedSeconds:Math.floor(totalElapsedMilliseconds/1000)};
}
export function mapClock(row:ClockRow,status:string,now=new Date()):MatchClockState{
 const legacyActive=row.phase!=="NOT_STARTED"&&(row.timing_model_version??0)!==1;
 const reviewRequired=legacyActive||(status==="IN_PROGRESS"&&row.phase==="NOT_STARTED")||(row.is_running&&(status!=="IN_PROGRESS"||!PLAYING_CLOCK_PHASES.includes(row.phase)));
 const running=row.is_running&&status==="IN_PROGRESS"&&PLAYING_CLOCK_PHASES.includes(row.phase)&&!reviewRequired;
 const accrued=clockAccrued({...row,is_running:running},now),iso=(v?:Date|null)=>v?new Date(v).toISOString():null;
 return {matchId:row.match_id,phase:row.phase,...accrued,isRunning:running,startedAt:running?iso(row.started_at):null,updatedBy:row.updated_by,updatedAt:new Date(row.updated_at).toISOString(),version:row.version,
  serverNow:now.toISOString(),phaseStartedAt:iso(row.phase_started_at),actualStartedAt:iso(row.actual_started_at),actualEndedAt:iso(row.actual_ended_at),addedTimeSeconds:row.added_time_seconds??0,
  interruption:row.interruption_kind??(status==="POSTPONED"?"POSTPONED":status==="CANCELLED"?"CANCELLED":null),interruptionReason:row.interruption_reason??null,reviewRequired,timingModelVersion:row.timing_model_version??0};
}
export async function getMatchClock(matchId:string):Promise<MatchClockState>{
 const row=await getPool().query("SELECT m.id AS owner_match_id,m.status AS match_status,m.updated_at AS match_updated_at,c.* FROM matches m LEFT JOIN match_clock_states c ON c.match_id=m.id WHERE m.id=$1",[matchId]);
 if(!row.rowCount)throw new AppError(404,"Không tìm thấy trận.","MATCH_NOT_FOUND");
 const r=row.rows[0];return mapClock(r.match_id?r:{match_id:matchId,phase:"NOT_STARTED",elapsed_seconds:0,total_elapsed_seconds:0,is_running:false,started_at:null,updated_by:null,updated_at:r.match_updated_at,version:0},r.match_status,await matchOperationNow(matchId));
}
async function history(client:PoolClient,row:ClockRow,saved:ClockRow,action:string,actorId:string,reason:string|null){
 await client.query("INSERT INTO match_clock_action_history(match_id,version,action,actor_id,reason,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",[row.match_id,saved.version,action,actorId,reason,JSON.stringify(row),JSON.stringify(saved)]);
}
/** Caller holds the Match row lock. No Scheduling database mutation is made here. */
export async function freezeMatchClock(client:PoolClient,matchId:string,kind:ClockInterruption,actorId:string,reason:string|null){
 const current=await client.query<ClockRow>("SELECT * FROM match_clock_states WHERE match_id=$1 FOR UPDATE",[matchId]),row=current.rows[0];
 if(!row||row.phase==="NOT_STARTED")return;
 const now=await matchOperationNow(matchId,client),time=clockAccrued(row,now);
 const saved=await client.query<ClockRow>(`UPDATE match_clock_states SET elapsed_seconds=$2,total_elapsed_seconds=$3,elapsed_milliseconds=$4,total_elapsed_milliseconds=$5,
  is_running=FALSE,started_at=NULL,interruption_kind=$6,interruption_reason=$7,updated_by=$8,updated_at=$9,version=version+1 WHERE match_id=$1 RETURNING *`,
 [matchId,time.elapsedSeconds,time.totalElapsedSeconds,time.elapsedMilliseconds,time.totalElapsedMilliseconds,kind,reason,actorId,now]);
 await history(client,row,saved.rows[0],kind,actorId,reason);await publishMatchUpdate(client,matchId,"match.clock.changed");
}
export async function applyMatchClockAction(matchId:string,action:MatchClockAction,expectedVersion:number,actorId:string,options:MatchClockActionOptions={}):Promise<MatchClockState>{
 return withOperationScheduleLock(matchId,async context=>{await assertOperationActor(context,actorId,"FINALIZE");return applyLockedClockAction(matchId,action,expectedVersion,actorId,context,options);});
}
async function applyLockedClockAction(matchId:string,action:MatchClockAction,expectedVersion:number,actorId:string,context:OperationScheduleContext,options:MatchClockActionOptions){
 const c=await getPool().connect();try{await c.query("BEGIN");
  const matches=await c.query<{id:string;status:string;home_team_id:string|null;away_team_id:string|null}>("SELECT id,status,home_team_id,away_team_id FROM matches WHERE id=$1 FOR UPDATE",[matchId]),match=matches.rows[0];
  if(!match)throw new AppError(404,"Không tìm thấy trận.","MATCH_NOT_FOUND");
  let found=await c.query<ClockRow>("SELECT * FROM match_clock_states WHERE match_id=$1 FOR UPDATE",[matchId]);
  if(!found.rowCount)found=await c.query<ClockRow>("INSERT INTO match_clock_states(match_id) VALUES($1) RETURNING *",[matchId]);
  const row=found.rows[0];
  if(row.version!==expectedVersion)throw new AppError(409,"Đồng hồ đã được cập nhật ở thiết bị khác. Hãy tải trạng thái mới; không tự lặp thao tác cũ.","CLOCK_VERSION_CONFLICT");
  if(row.phase!=="NOT_STARTED"&&(row.timing_model_version??0)!==1)throw new AppError(409,"Dữ liệu thời gian cũ chưa đủ căn cứ xác định hiệp và thời điểm. Cần BTC kiểm tra có thẩm quyền; không tự reset.","CLOCK_MODEL_REVIEW_REQUIRED");
  const rules=await getEffectiveMatchRules(matchId,c);assertRuleOperation(rules,"CLOCK");assertClockRuleAction(rules,action,row.phase);
  const readiness=await getMatchOperationReadiness(matchId,context,c);
  if(!readiness.fixturePublished||!readiness.teamsResolved||readiness.tournamentStatus!=="IN_PROGRESS")throw new AppError(409,"Giải hoặc sơ đồ chưa cho phép điều khiển thi đấu.","MATCH_OPERATION_NOT_READY");
  if((await c.query("SELECT 1 FROM match_reports WHERE match_id=$1 AND status='APPROVED'",[matchId])).rowCount)throw new AppError(409,"Kết quả trận đã được xác nhận; không điều khiển đồng hồ.","MATCH_RESULT_LOCKED");
  if(action==="START_MATCH"){
   if(match.status!=="LINEUP_CONFIRMED")throw new AppError(409,"Chỉ bắt đầu trận sau khi trọng tài xác nhận sẵn sàng.","MATCH_NOT_READY");
   assertMatchStartPrerequisites({homeTeamId:match.home_team_id,awayTeamId:match.away_team_id,hasPublishedSchedule:context.schedule.status==="PUBLISHED",publishedOfficialCount:readiness.crewPublished?context.crew.length:0,finalAuthorityCount:context.crew.filter(m=>m.isFinalAuthority===true).length});
   if(!readiness.lineupsConfirmed)throw new AppError(409,"Hai đội phải có đội hình hợp lệ đã được kiểm tra trước khi bắt đầu.","MATCH_LINEUPS_NOT_READY");
   assertKickoffReached(context.schedule.scheduledDate,(await matchOperationNow(matchId,c)).getTime());
   if(!readiness.canStart)throw new AppError(409,"Trận chưa đủ điều kiện bắt đầu.","MATCH_OPERATION_NOT_READY",{issues:readiness.issues});
   const squad=(await c.query('SELECT player_id AS "playerId",team_id AS "teamId",is_starting AS "isStarting",position FROM lineups WHERE match_id=$1',[matchId])).rows;
   const priorEvents=(await c.query('SELECT *,team_id AS "teamId",player_id AS "playerId",event_type AS "eventType",substitution_id AS "substitutionId",related_player_id AS "relatedPlayerId",opportunity_id AS "opportunityId",COALESCE(logical_sequence,event_sequence)::text AS "eventSequence",period_elapsed_seconds AS "periodElapsedSeconds",created_at::text AS "createdAt" FROM match_events WHERE match_id=$1 AND voided_at IS NULL ORDER BY event_sequence',[matchId])).rows;
   let active;try{active=projectMatchPlayers(squad,priorEvents,rules.rules.values);}catch(e){throw new AppError(409,'Chuỗi sự kiện trước trận không còn hợp lệ.','EVENT_CHAIN_INVALID');}
   for(const team of [match.home_team_id,match.away_team_id]){const field=squad.filter(p=>p.teamId===team&&active.onField.has(p.playerId));if(field.length<Number(rules.rules.values.minimumPlayers)||field.filter(p=>['GK','GOALKEEPER'].includes(p.position)).length!==Number(rules.rules.values.goalkeepers))throw new AppError(409,'Đội hình sau các sự kiện trước trận chưa đủ cầu thủ hoặc thủ môn.','MATCH_LINEUPS_NOT_READY');}
  }
  const now=await matchOperationNow(matchId,c),time=clockAccrued(row,now);
  const scores=await c.query<{home:number;away:number}>(`SELECT COALESCE(SUM(CASE WHEN (team_id=$2 AND event_type<>'OWN_GOAL') OR (team_id=$3 AND event_type='OWN_GOAL') THEN 1 ELSE 0 END),0)::int AS home,
   COALESCE(SUM(CASE WHEN (team_id=$3 AND event_type<>'OWN_GOAL') OR (team_id=$2 AND event_type='OWN_GOAL') THEN 1 ELSE 0 END),0)::int AS away
   FROM match_events WHERE match_id=$1 AND voided_at IS NULL AND event_type IN ('GOAL','PENALTY_GOAL','OWN_GOAL') AND phase IS DISTINCT FROM 'PENALTIES'`,[matchId,match.home_team_id,match.away_team_id]);
  const outcome=await stageOutcome(matchId,c);
  if(['START_EXTRA_TIME','START_PENALTIES','END_MATCH'].includes(action)&&outcome.unknownPhase)throw new AppError(409,'Có bàn thắng chưa xác định được hiệp. Cần đối chiếu trước khi phân định kết quả.','RESULT_EVENT_PHASE_UNKNOWN');
  const shootout=outcome.shootout?.winnerTeamId?outcome.shootout.score:null;
  if(action==='START_PENALTIES'){
   // Candidate/policy validation is also enforced by the setup API. No aggregate-score fallback.
   if(!['IFAB_2026_27','VFF_7_433_2023','FIFA_FUTSAL_2026_27'].includes(rules.rules.lawCode??''))throw new AppError(409,'Chưa xác định đủ quy trình luân lưu của bộ luật này.','SHOOTOUT_POLICY_UNDEFINED');
  }
  if(action==='END_PERIOD'&&row.phase==='PENALTIES'){const workspace=await getShootoutWorkspace(matchId,c);if(workspace?.issues.length)throw new AppError(409,workspace.issues.join(' '),'SHOOTOUT_ELIGIBILITY_REVIEW');}
  assertClockTimingAction({status:match.status,phase:row.phase,isRunning:row.is_running,elapsedSeconds:time.elapsedSeconds,addedTimeSeconds:row.added_time_seconds??0,interruption:row.interruption_kind??null,rules,action,options,score:scores.rows[0]??{home:0,away:0},shootoutScore:shootout});
  const next=transitionMatchClock(row.phase,row.is_running,action),phaseChanged=next.phase!==row.phase;
  const interruption=action==="PAUSE"?"CLOCK_STOP":action==="SUSPEND_PLAY"?"PLAY_SUSPENDED":null;
  const added=phaseChanged?0:action==="DECLARE_ADDED_TIME"?options.addedTimeSeconds!:row.added_time_seconds??0;
  const saved=await c.query<ClockRow>(`UPDATE match_clock_states SET phase=$2,elapsed_seconds=$3,total_elapsed_seconds=$4,is_running=$5,started_at=$6,updated_by=$7,updated_at=$8,version=version+1,
   phase_started_at=$9,actual_started_at=CASE WHEN $10 THEN $8 ELSE actual_started_at END,actual_ended_at=CASE WHEN $11 THEN $8 ELSE actual_ended_at END,
   elapsed_milliseconds=$12,total_elapsed_milliseconds=$13,added_time_seconds=$14,interruption_kind=$15,interruption_reason=$16,timing_model_version=1
   WHERE match_id=$1 AND version=$17 RETURNING *`,[matchId,next.phase,phaseChanged?0:time.elapsedSeconds,time.totalElapsedSeconds,next.isRunning,next.isRunning?now:null,actorId,now,phaseChanged?now:row.phase_started_at??null,action==="START_MATCH",next.phase==="ENDED",phaseChanged?0:time.elapsedMilliseconds,time.totalElapsedMilliseconds,added,interruption,interruption?options.reason?.trim()||null:null,expectedVersion]);
  if(!saved.rowCount)throw new AppError(409,"Đồng hồ vừa thay đổi ở thiết bị khác.","CLOCK_VERSION_CONFLICT");
  await history(c,row,saved.rows[0],action,actorId,options.reason?.trim()||null);
  if(next.phase==='ENDED')await saveFinishedOutcome(c,matchId,actorId,now);
  if(next.matchStatus){await c.query("UPDATE matches SET status=$2,updated_at=$3 WHERE id=$1",[matchId,next.matchStatus,now]);await publishMatchUpdate(c,matchId,"match.status.changed");}
  await publishMatchUpdate(c,matchId,"match.clock.changed");await c.query("COMMIT");return mapClock(saved.rows[0],next.matchStatus??match.status,now);
 }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
}
import {projectMatchPlayers} from '@sfl/shared';

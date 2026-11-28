import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../lib/db';
import { AppError } from '../lib/errors';
import { freezeMatchClock } from './matchClockRepository';
import { publishMatchUpdate } from '../realtime/matchRealtime';
import { getEffectiveMatchRules, assertResultRulePolicy } from '../services/matchOperationRulesService';
import { stageOutcome } from './matchOutcomeRepository';
import { advanceApprovedKnockoutWinner, recalculateStandings, recordForfeitResult } from './matchRepository';
import { matchOperationNow } from '../services/matchOperationTime';
import { readOperationSchedule,withOperationScheduleLock,type OperationScheduleContext } from '../scheduling/repositories/matchOperationReadinessRepository';
import { crewReadiness } from '../services/matchOperationReadinessService';

export const incidentKinds=['LATE_ARRIVAL','TEAM_ABSENT','INSUFFICIENT_PLAYERS','WITHDRAWAL','WEATHER','VENUE_UNSAFE','SECURITY','REGULATION_VIOLATION','OTHER'] as const;
export type AdministrationAction='POSTPONE'|'SUSPEND'|'CANCEL'|'CONTINUE'|'REPLAY'|'RECOGNIZE'|'FORFEIT'|'DISMISS';
type Row=Record<string,any>;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function actionPolicyReady(action:AdministrationAction,rules:Awaited<ReturnType<typeof getEffectiveMatchRules>>){
 const values=rules.rules.values,declared=(key:string)=>typeof values[key]==='string'&&String(values[key]).trim().length>0;
 if(['POSTPONE','SUSPEND','CONTINUE','REPLAY'].includes(action))return declared('matchInterruptionPolicy');
 if(action==='CANCEL')return declared('matchCancellationPolicy')&&['EXCLUDE_FROM_COMPETITION','REQUIRES_REPLACEMENT'].includes(String(values.cancelledMatchPolicy));
 if(action==='RECOGNIZE')return declared('resultRecognitionPolicy')&&!rules.missing.FINALIZE.length;
 if(action==='FORFEIT')return ['ORGANIZER_DECISION','WALKOVER'].includes(String(values.forfeitPolicy))&&Number.isInteger(values.forfeitWinnerScore)&&Number.isInteger(values.forfeitLoserScore)&&Number(values.forfeitWinnerScore)>Number(values.forfeitLoserScore);
 return action==='DISMISS';
}
function policyActions(actions:AdministrationAction[],rules:Awaited<ReturnType<typeof getEffectiveMatchRules>>){return actions.filter(action=>actionPolicyReady(action,rules));}
export function administrationActions(status:string,clockPhase:string|null,hasOfficialResult:boolean,operationStatus?:string|null):AdministrationAction[]{
 if(hasOfficialResult||['VERIFIED','LOCKED','CANCELLED'].includes(status))return ['DISMISS'];
 if(operationStatus==='REPLAY_REQUIRED')return ['DISMISS'];
 if(status==='POSTPONED')return ['CONTINUE','REPLAY','CANCEL','RECOGNIZE','FORFEIT','DISMISS'];
 if(status==='IN_PROGRESS')return ['SUSPEND','POSTPONE','CANCEL','RECOGNIZE','FORFEIT','DISMISS'];
 if(status==='FINISHED')return ['RECOGNIZE','DISMISS'];
 return ['SCHEDULED','LINEUP_CONFIRMED','UNSCHEDULED'].includes(status)?['POSTPONE','CANCEL','FORFEIT','DISMISS']:['DISMISS'];
}
async function lockedMatch(c:PoolClient,id:string){
 const m=(await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!m)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');return m;
}
export async function createAdministrativeCase(matchId:string,actorId:string,input:Row){
 if(!incidentKinds.includes(input.kind)||typeof input.description!=='string'||input.description.trim().length<5||input.description.length>4000||input.evidence!=null&&(typeof input.evidence!=='string'||input.evidence.length>4000))throw new AppError(400,'Cần loại sự cố, mô tả từ 5–4000 ký tự và chứng cứ hợp lệ.','INCIDENT_INVALID');
 const c=await getPool().connect();try{await c.query('BEGIN');await lockedMatch(c,matchId);
  const item=(await c.query(`INSERT INTO match_administrative_cases(match_id,kind,description,evidence,reported_by) VALUES($1,$2,$3,$4,$5) RETURNING *`,[matchId,input.kind,input.description.trim(),input.evidence?.trim()||null,actorId])).rows[0];
  await publishMatchUpdate(c,matchId,'match.incident.reported');await c.query('COMMIT');return item;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function administrativeContext(matchId:string){
 const q=getPool();const [cases,decisions,clock,result,pending,scheduleRows]=await Promise.all([
  q.query('SELECT * FROM match_administrative_cases WHERE match_id=$1 ORDER BY created_at DESC,id',[matchId]),
  q.query('SELECT * FROM match_administrative_decisions WHERE match_id=$1 ORDER BY revision DESC',[matchId]),
  q.query('SELECT * FROM match_clock_states WHERE match_id=$1',[matchId]),
  q.query("SELECT status FROM match_results WHERE match_id=$1 AND status='APPROVED'",[matchId]),
  q.query('SELECT target,attempts,error_code FROM match_administrative_outbox WHERE completed_at IS NULL AND decision_id IN(SELECT id FROM match_administrative_decisions WHERE match_id=$1)',[matchId]),
  (async()=>{const p=(await import('../scheduling/lib/db')).getPool();return p.query("SELECT operation_status FROM schedules WHERE match_id=$1 AND status<>'CANCELLED' ORDER BY updated_at DESC LIMIT 1",[matchId]);})()]);
 const m=(await q.query('SELECT status,administration_revision FROM matches WHERE id=$1',[matchId])).rows[0];
 if(!m)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');
 const rules=await getEffectiveMatchRules(matchId);
 return {cases:cases.rows,decisions:decisions.rows,revision:m.administration_revision,clockVersion:clock.rows[0]?.version??0,actions:policyActions(administrationActions(m.status,clock.rows[0]?.phase??null,Boolean(result.rowCount),scheduleRows.rows[0]?.operation_status??null),rules),policyMissing:{interruption:!actionPolicyReady('POSTPONE',rules),cancellation:!actionPolicyReady('CANCEL',rules),recognition:!actionPolicyReady('RECOGNIZE',rules),forfeit:!actionPolicyReady('FORFEIT',rules)},synchronization:{complete:!pending.rowCount,pending:pending.rows}};
}
export async function decideAdministrativeCase(matchId:string,caseId:string,actorId:string,input:Row,providedClient?:PoolClient,scheduleContext?:OperationScheduleContext):Promise<{decision:Row;alreadyApplied:boolean}>{
 if(!uuid(input.requestId)||!Number.isInteger(input.expectedVersion)||!Number.isInteger(input.expectedMatchRevision)||!Number.isInteger(input.expectedClockVersion)||typeof input.basis!=='string'||input.basis.trim().length<5||input.basis.length>4000||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>4000)throw new AppError(400,'Cần căn cứ điều lệ, lý do và phiên bản hồ sơ/trận/đồng hồ hiện tại.','ADMINISTRATIVE_DECISION_INVALID');
 const signature=createHash('sha256').update(JSON.stringify({matchId,caseId,actorId,action:input.action,basis:input.basis.trim(),reason:input.reason.trim(),forfeitingTeamId:input.forfeitingTeamId??null})).digest('hex');
  if(!providedClient&&!scheduleContext&&input.action!=='DISMISS'){
  const current=await readOperationSchedule(matchId);
  if(current?.schedule.status==='PUBLISHED')return withOperationScheduleLock(matchId,context=>decideAdministrativeCase(matchId,caseId,actorId,input,undefined,context),input.action==='CONTINUE');
 }
 const c=providedClient??await getPool().connect();try{if(!providedClient)await c.query('BEGIN');const m=await lockedMatch(c,matchId);
  const prior=(await c.query('SELECT * FROM match_administrative_decisions WHERE request_id=$1',[input.requestId])).rows[0];
  if(prior){if(prior.after_snapshot.requestSignature!==signature)throw new AppError(409,'Mã thao tác đã được dùng cho quyết định khác.','ADMINISTRATIVE_REQUEST_REUSED');if(!providedClient)await c.query('COMMIT');return {decision:prior,alreadyApplied:true};}
  const item=(await c.query('SELECT * FROM match_administrative_cases WHERE id=$1 AND match_id=$2 FOR UPDATE',[caseId,matchId])).rows[0];
  if(!item)throw new AppError(404,'Không tìm thấy hồ sơ sự cố của trận.','INCIDENT_NOT_FOUND');
  const clock=(await c.query('SELECT * FROM match_clock_states WHERE match_id=$1 FOR UPDATE',[matchId])).rows[0];
  if(item.resolved_at||item.version!==input.expectedVersion||m.administration_revision!==input.expectedMatchRevision||(clock?.version??0)!==input.expectedClockVersion)throw new AppError(409,'Hồ sơ, trận hoặc đồng hồ vừa thay đổi. Tải lại trước khi quyết định.','ADMINISTRATIVE_VERSION_CONFLICT');
  const official=Boolean((await c.query("SELECT 1 FROM match_results WHERE match_id=$1 AND status='APPROVED'",[matchId])).rowCount);
  const rules=await getEffectiveMatchRules(matchId,c);
  if(!administrationActions(m.status,clock?.phase??null,official,scheduleContext?.schedule.operationStatus).includes(input.action))throw new AppError(409,'Quyết định không hợp lệ với trạng thái trận hoặc trạng thái lịch. Kết quả chính thức phải qua đính chính.','ADMINISTRATIVE_ACTION_NOT_ALLOWED');
  if(!actionPolicyReady(input.action,rules))throw new AppError(409,'Điều lệ đã công bố chưa xác định căn cứ và thẩm quyền cho quyết định này. Giữ hồ sơ sự cố ở trạng thái cần BTC xử lý, không tự áp dụng.','ADMINISTRATIVE_RULE_UNDEFINED',{action:input.action,missing:input.action==='POSTPONE'||input.action==='SUSPEND'||input.action==='CONTINUE'||input.action==='REPLAY'?['matchInterruptionPolicy']:input.action==='CANCEL'?['matchCancellationPolicy','cancelledMatchPolicy']:input.action==='RECOGNIZE'?['resultRecognitionPolicy','FINALIZE']:['forfeitPolicy','forfeitWinnerScore','forfeitLoserScore']});
  const now=await matchOperationNow(matchId,c),before:Row={match:m,clock:clock??null},id=randomUUID();
  let status=m.status,operationStatus:string|null=null;
  if(input.action==='POSTPONE'||input.action==='SUSPEND'){status='POSTPONED';operationStatus=input.action==='SUSPEND'?'SUSPENDED':'POSTPONED';await freezeMatchClock(c,matchId,input.action==='SUSPEND'?'PLAY_SUSPENDED':'POSTPONED',actorId,input.reason);}
  else if(input.action==='CANCEL'){status='CANCELLED';operationStatus='CANCELLED';await freezeMatchClock(c,matchId,'CANCELLED',actorId,input.reason);}
  else if(input.action==='CONTINUE'){
   const context=scheduleContext;
   if(!context||context.schedule.status!=='PUBLISHED'||!['POSTPONED','SUSPENDED'].includes(context.schedule.operationStatus??'')||!crewReadiness({...context,schedule:{...context.schedule,operationStatus:null}}).valid)throw new AppError(409,'Cần lịch và tổ trọng tài công bố còn khớp, đồng bộ trạng thái hoãn và xác nhận tiếp tục.','CONTINUATION_SCHEDULE_CREW_REQUIRED');
   if(Date.parse(context.schedule.scheduledDate)>now.getTime())throw new AppError(409,'Chưa đến giờ tiếp tục theo lịch đã công bố.','MATCH_KICKOFF_NOT_REACHED');
   status=clock&&clock.phase!=='NOT_STARTED'?'IN_PROGRESS':'SCHEDULED';operationStatus='ACTIVE';
   if(clock)await c.query("UPDATE match_clock_states SET is_running=FALSE,started_at=NULL,interruption_kind=$2,interruption_reason=$3,version=version+1,updated_by=$4,updated_at=$5 WHERE match_id=$1",[matchId,status==='IN_PROGRESS'?'PLAY_SUSPENDED':null,input.reason,actorId,now]);
  }else if(input.action==='FORFEIT'){
   const b=rules.base.rules;
   if(!b||!['ORGANIZER_DECISION','WALKOVER'].includes(String(b.forfeitPolicy))||!Number.isInteger(b.forfeitWinnerScore)||!Number.isInteger(b.forfeitLoserScore)||Number(b.forfeitWinnerScore)<=Number(b.forfeitLoserScore))throw new AppError(409,'Điều lệ chưa có chính sách và tỷ số xử thua hợp lệ. Không tự đặt tỷ số.','FORFEIT_POLICY_UNDEFINED');
   await recordForfeitResult({matchId,forfeitingTeamId:input.forfeitingTeamId,reason:input.reason,winnerScore:Number(b.forfeitWinnerScore),loserScore:Number(b.forfeitLoserScore),policy:String(b.forfeitPolicy)},actorId,c);
   status='VERIFIED';operationStatus='RESOLVED';
  }else if(input.action==='RECOGNIZE'){
   if(!clock?.actual_started_at)throw new AppError(409,'Trận chưa thi đấu không có tỷ số trên sân để công nhận. Dùng quyết định hành chính phù hợp.','RECOGNITION_FIELD_DATA_REQUIRED');
   const outcome=await stageOutcome(matchId,c);if(outcome.unknownPhase)throw new AppError(409,'Diễn biến chưa đủ pha thi đấu để xác định tỷ số.','RESULT_EVENT_PHASE_UNKNOWN');
   assertResultRulePolicy(rules,outcome.input,true);
   await freezeMatchClock(c,matchId,'POSTPONED',actorId,input.reason);
   await c.query('UPDATE match_clock_states SET actual_ended_at=COALESCE(actual_ended_at,$2) WHERE match_id=$1',[matchId,now]);
   const s=outcome.input,args=[matchId,s.homeScore,s.awayScore,s.homeExtraTimeScore,s.awayExtraTimeScore,s.homePenaltyScore,s.awayPenaltyScore,actorId,outcome.winnerTeamId,now,input.reason];
   const result=(await c.query('SELECT id FROM match_results WHERE match_id=$1 FOR UPDATE',[matchId])).rows[0];
   if(result)await c.query(`UPDATE match_results SET home_score=$2,away_score=$3,home_extra_time_score=$4,away_extra_time_score=$5,home_penalty_score=$6,away_penalty_score=$7,recorded_by=$8,winner_team_id=$9,finished_at=$10,notes=$11,status='APPROVED',result_origin='ADMINISTRATIVE',recorded_at=NOW() WHERE match_id=$1`,args);
   else await c.query(`INSERT INTO match_results(match_id,home_score,away_score,home_extra_time_score,away_extra_time_score,home_penalty_score,away_penalty_score,recorded_by,winner_team_id,finished_at,notes,status,result_origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'APPROVED','ADMINISTRATIVE')`,args);
   status='VERIFIED';operationStatus='RESOLVED';await c.query("UPDATE matches SET status='VERIFIED' WHERE id=$1",[matchId]);
   if(outcome.winnerTeamId)await advanceApprovedKnockoutWinner(c,matchId,outcome.winnerTeamId);
   await recalculateStandings(c,m.tournament_id);
  }else if(input.action==='REPLAY'){
   // A replay decision is not permission to overwrite this fixture or reset its clock.
   // The replacement fixture/schedule must be prepared through the official fixture and scheduling workflow.
   before.replayRequiresFixture=true;
   before.officialResultExists=official;
   await freezeMatchClock(c,matchId,'POSTPONED',actorId,input.reason);
   status='POSTPONED';operationStatus='REPLAY_REQUIRED';
  }
  const revision=m.administration_revision+1;
  await c.query('UPDATE matches SET status=$2,administration_revision=$3,updated_at=NOW() WHERE id=$1',[matchId,status,revision]);
  const after={match:(await c.query('SELECT * FROM matches WHERE id=$1',[matchId])).rows[0],clock:(await c.query('SELECT * FROM match_clock_states WHERE match_id=$1',[matchId])).rows[0]??null,operationStatus,requestSignature:signature};
  const decision=(await c.query(`INSERT INTO match_administrative_decisions(id,request_id,case_id,match_id,revision,action,basis,reason,actor_id,before_snapshot,after_snapshot,rule_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb) RETURNING *`,[id,input.requestId,caseId,matchId,revision,input.action,input.basis.trim(),input.reason.trim(),actorId,JSON.stringify(before),JSON.stringify(after),JSON.stringify(rules)])).rows[0];
  if(input.action==='REPLAY')await c.query('INSERT INTO match_replay_attempts(match_id,decision_id,snapshot) VALUES($1,$2,$3::jsonb)',[matchId,id,JSON.stringify(before)]);
  await c.query('UPDATE match_administrative_cases SET resolved_at=NOW(),version=version+1 WHERE id=$1',[caseId]);
  const payload={matchId,tournamentId:m.tournament_id,revision,operationStatus,actorId,reason:input.reason,action:input.action,homeTeamId:m.home_team_id,awayTeamId:m.away_team_id};
  for(const target of operationStatus?['SCHEDULING','NOTIFICATION']:['NOTIFICATION'])await c.query('INSERT INTO match_administrative_outbox(decision_id,target,payload) VALUES($1,$2,$3::jsonb)',[id,target,JSON.stringify(payload)]);
  await publishMatchUpdate(c,matchId,'match.administrative-decision');if(!providedClient)await c.query('COMMIT');return {decision,alreadyApplied:false};
 }catch(e){if(!providedClient)await c.query('ROLLBACK');throw e;}finally{if(!providedClient)c.release();}
}

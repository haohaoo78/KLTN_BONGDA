import {saveFinishedOutcome} from './matchOutcomeRepository';
import {createHash,randomUUID} from 'crypto';
import {projectMatchPlayers,PLAYING_CLOCK_PHASES,compareMatchEventTiming,type MatchClockPhase} from '@sfl/shared';
import {getPool} from '../lib/db';
import {AppError} from '../lib/errors';
import type {MatchEvent,MatchEventCreateInput} from '../models/match';
import {clockAccrued,type ClockRow} from './matchClockRepository';
import {getEffectiveMatchRules,assertRuleOperation} from '../services/matchOperationRulesService';
import {deriveMatchEventTiming} from '../services/matchEventTiming';
import {publishMatchUpdate} from '../realtime/matchRealtime';

export const mapEvent=(r:any):MatchEvent=>({id:r.id,matchId:r.match_id,teamId:r.team_id,playerId:r.player_id,eventType:r.event_type,minute:r.minute,description:r.description,createdBy:r.created_by,createdAt:new Date(r.created_at).toISOString(),phase:r.phase,periodElapsedSeconds:r.period_elapsed_seconds,addedTimeSeconds:r.added_time_seconds,eventSequence:String(r.logical_sequence??r.event_sequence),operationId:r.operation_id,substitutionId:r.substitution_id,relatedPlayerId:r.related_player_id,opportunityId:r.opportunity_id,revision:r.revision,visibility:r.visibility,supersedesEventId:r.supersedes_event_id,voidedAt:r.voided_at,voidedBy:r.voided_by,voidReason:r.void_reason});
const cardTypes=['YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD'];
const eventTypes=['GOAL','PENALTY_GOAL','OWN_GOAL',...cardTypes,'SUBSTITUTION_OUT','SUBSTITUTION_IN','INJURY','PLAYER_LEAVE','PLAYER_RETURN','REPLACEMENT_IN','INCIDENT'];
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function validate(input:MatchEventCreateInput){
 if(!eventTypes.includes(input.eventType))throw new AppError(400,'Loại sự kiện không được hỗ trợ.','INVALID_EVENT_TYPE');
 for(const [key,value] of Object.entries({matchId:input.matchId,teamId:input.teamId,playerId:input.playerId,relatedPlayerId:input.relatedPlayerId,operationId:input.operationId,opportunityId:input.opportunityId}))if(value!=null&&!uuid(value))throw new AppError(400,`Định danh ${key} không hợp lệ.`,'VALIDATION_ERROR');
 if(input.visibility!=null&&!['PUBLIC','CREW'].includes(input.visibility))throw new AppError(400,'Phạm vi hiển thị không hợp lệ.','VALIDATION_ERROR');
 if(input.description!=null&&(typeof input.description!=='string'||input.description.length>2000))throw new AppError(400,'Ghi chú tối đa 2000 ký tự.','VALIDATION_ERROR');
 if(input.eventType==='INCIDENT'&&(!input.description||input.description.trim().length<5))throw new AppError(400,'Cần mô tả sự cố cụ thể.','INCIDENT_REASON_REQUIRED');
 if(input.eventType==='SUBSTITUTION_IN')throw new AppError(400,'Hãy ghi thay người bằng một thao tác chọn cả cầu thủ ra và vào.','ATOMIC_SUBSTITUTION_REQUIRED');
 if(input.eventType==='SUBSTITUTION_OUT'&&(!input.relatedPlayerId||input.playerId===input.relatedPlayerId))throw new AppError(400,'Chọn hai cầu thủ khác nhau cho thao tác thay người.','ATOMIC_SUBSTITUTION_REQUIRED');
 if(input.visibility==='CREW'&&input.eventType!=='INCIDENT'&&input.eventType!=='INJURY')throw new AppError(400,'Sự kiện chuyên môn phải hiển thị công khai.','INVALID_EVENT_VISIBILITY');
 if(input.supersedesId&&(!uuid(input.supersedesId)||typeof input.correctionReason!=='string'||input.correctionReason.trim().length<5||input.correctionReason.length>2000||!Number.isInteger(input.expectedRevision)||input.expectedRevision!<1))throw new AppError(400,'Đính chính cần phiên bản sự kiện và lý do từ 5 đến 2000 ký tự.','EVENT_CORRECTION_INVALID');
}
function assertChain(players:any[],events:MatchEvent[],rules:any){try{projectMatchPlayers(players,events,rules);}catch(e:any){throw new AppError(409,e.message,'EVENT_CHAIN_INVALID',{eventId:e.eventId});}}
export async function writeMatchEvent(input:MatchEventCreateInput,actor:string):Promise<MatchEvent>{
 validate(input);const c=await getPool().connect();
 try{await c.query('BEGIN');const m=(await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[input.matchId])).rows[0];if(!m)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');
 const requestHash=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries({...input,operationId:undefined}).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
 if(input.operationId){const prior=(await c.query('SELECT * FROM match_events WHERE match_id=$1 AND operation_id=$2 ORDER BY event_sequence',[input.matchId,input.operationId])).rows;if(prior.length){if(prior[0].request_hash!==requestHash||prior[0].created_by!==actor)throw new AppError(409,'Mã thao tác đã dùng cho nội dung khác.','EVENT_IDEMPOTENCY_CONFLICT');await c.query('COMMIT');return mapEvent(prior[0]);}}
 const previous=input.supersedesId?(await c.query('SELECT * FROM match_events WHERE id=$1 AND match_id=$2 FOR UPDATE',[input.supersedesId,input.matchId])).rows[0]:null;
 if((await c.query('SELECT 1 FROM match_shootouts WHERE match_id=$1',[input.matchId])).rowCount&&(previous&&previous.phase!=='PENALTIES'||!['YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD','INJURY','INCIDENT'].includes(input.eventType)))throw new AppError(409,'Loạt luân lưu đã thiết lập; không đổi nguồn đội hình hoặc bàn thắng trước đó qua chỉnh sửa thông thường.','SHOOTOUT_SOURCE_LOCKED');
 if(input.supersedesId&&(!previous||previous.voided_at||previous.revision!==input.expectedRevision))throw new AppError(409,'Sự kiện đã được điều chỉnh trên thiết bị khác.','EVENT_VERSION_CONFLICT');
 const passive=cardTypes.includes(input.eventType)||['INJURY','INCIDENT'].includes(input.eventType),preReplacement=input.eventType==='REPLACEMENT_IN'&&m.status==='LINEUP_CONFIRMED';
 if(!(passive||previous?['LINEUP_CONFIRMED','IN_PROGRESS','FINISHED']:preReplacement?['LINEUP_CONFIRMED']:['IN_PROGRESS']).includes(m.status))throw new AppError(409,'Trạng thái trận không cho phép ghi sự kiện này.','MATCH_EVENT_LOCKED');
 if((await c.query("SELECT 1 FROM match_reports WHERE match_id=$1 AND status IN ('PENDING','APPROVED')",[input.matchId])).rowCount)throw new AppError(409,'Biên bản đã gửi; cần xử lý điều chỉnh đúng thẩm quyền.','MATCH_REPORT_LOCKED');
 if(![m.home_team_id,m.away_team_id].includes(input.teamId))throw new AppError(400,'Đội không thuộc trận.','INVALID_EVENT_TEAM');
 if(m.status==='LINEUP_CONFIRMED'&&passive){await c.query('INSERT INTO match_clock_states(match_id,timing_model_version) VALUES($1,1) ON CONFLICT(match_id) DO NOTHING',[input.matchId]);await c.query("UPDATE match_clock_states SET timing_model_version=1 WHERE match_id=$1 AND phase='NOT_STARTED' AND elapsed_seconds=0 AND actual_started_at IS NULL",[input.matchId]);}
 const clock=(await c.query<ClockRow>('SELECT * FROM match_clock_states WHERE match_id=$1 FOR UPDATE',[input.matchId])).rows[0];if(!clock)throw new AppError(409,'Chưa có đồng hồ chính thức.','MATCH_CLOCK_NOT_RUNNING');
 const rules=await getEffectiveMatchRules(input.matchId,c);assertRuleOperation(rules,'CLOCK');
 if(input.eventType==='SUBSTITUTION_OUT'){assertRuleOperation(rules,'SUBSTITUTION');if(String(clock.phase).startsWith('EXTRA_TIME')&&rules.rules.values.substitutionMode==='LIMITED'&&(rules.rules.values.extraTimeSubstitutions==null||rules.rules.values.extraTimeOpportunities==null))throw new AppError(409,'Chưa xác định số người/cơ hội thay thêm trong hiệp phụ.','MATCH_RULES_UNDEFINED');}
 if(cardTypes.includes(input.eventType)&&!rules.rules.values.redCardReduction)throw new AppError(409,'Chưa xác định quy tắc giảm người sau truất quyền.','MATCH_RULES_UNDEFINED');
 const elapsed=clockAccrued(clock).elapsedSeconds;
 let timing:{phase:MatchClockPhase;periodElapsedSeconds:number;minute:number;addedTimeSeconds:number};
 if(previous&&input.phase!==clock.phase){
  if(!previous.phase||input.phase!==previous.phase)throw new AppError(409,'Chỉ đính chính thời điểm trong hiệp gốc đã được lưu chính thức.','EVENT_PHASE_INVALID');
  if(PLAYING_CLOCK_PHASES.includes(previous.phase)){
   const h=(await c.query("SELECT before_snapshot,after_snapshot FROM match_clock_action_history WHERE match_id=$1 AND action='END_PERIOD' AND before_snapshot->>'phase'=$2 ORDER BY version DESC LIMIT 1",[input.matchId,previous.phase])).rows[0];
   if(!h)throw new AppError(409,'Chưa có mốc kết thúc hiệp để kiểm chứng thời gian đính chính.','EVENT_TIME_REVIEW_REQUIRED');
   const before=h.before_snapshot,after=h.after_snapshot,max=Math.floor((Number(after.total_elapsed_milliseconds??after.total_elapsed_seconds*1000)-Number(before.total_elapsed_milliseconds??before.total_elapsed_seconds*1000)+Number(before.elapsed_milliseconds??before.elapsed_seconds*1000))/1000);
   if(!Number.isSafeInteger(max)||max<0)throw new AppError(409,'Mốc thời gian hiệp cần được kiểm tra.','EVENT_TIME_REVIEW_REQUIRED');
   timing=deriveMatchEventTiming(input,{phase:previous.phase,version:clock.version,elapsedSeconds:max,timing_model_version:1},rules);
  }else{if(input.expectedClockVersion!=null&&input.expectedClockVersion!==clock.version)throw new AppError(409,'Đồng hồ đã đổi.','CLOCK_VERSION_CONFLICT');timing={phase:previous.phase,periodElapsedSeconds:0,minute:previous.minute,addedTimeSeconds:0};}
 }else if((passive||preReplacement||input.eventType==='SUBSTITUTION_OUT'&&['HALF_TIME','EXTRA_TIME_HALF_TIME','REGULATION_COMPLETE'].includes(clock.phase))&&!PLAYING_CLOCK_PHASES.includes(clock.phase)){
  if(clock.timing_model_version!==1)throw new AppError(409,'Cần kiểm tra clock cũ.','CLOCK_MODEL_REVIEW_REQUIRED');
  if(input.expectedClockVersion!=null&&input.expectedClockVersion!==clock.version)throw new AppError(409,'Đồng hồ đã đổi.','CLOCK_VERSION_CONFLICT');
  if(input.phase!=null&&input.phase!==clock.phase)throw new AppError(409,'Giai đoạn đã đổi.','EVENT_PHASE_CHANGED');
  if(input.periodElapsedSeconds!=null&&input.periodElapsedSeconds!==0)throw new AppError(400,'Giai đoạn ngoài hiệp dùng thời điểm 0.','EVENT_TIME_INVALID');
  timing={phase:clock.phase,periodElapsedSeconds:0,minute:Math.floor(clock.total_elapsed_seconds/60),addedTimeSeconds:0};
 }else{
  if(!previous&&!passive&&!clock.is_running&&!(rules.rules.values.clockMode==='STOPPED'&&clock.interruption_kind==='CLOCK_STOP')&&!(input.eventType==='SUBSTITUTION_OUT'&&['HALF_TIME','EXTRA_TIME_HALF_TIME','REGULATION_COMPLETE'].includes(clock.phase)))throw new AppError(409,'Hiệp hoặc trạng thái đồng hồ chưa cho phép.','MATCH_CLOCK_NOT_RUNNING');
  timing=deriveMatchEventTiming(input,{...clock,elapsedSeconds:elapsed},rules);
 }
 const players=(await c.query('SELECT player_id AS "playerId",team_id AS "teamId",is_starting AS "isStarting" FROM lineups WHERE match_id=$1',[input.matchId])).rows;
 if(rules.rules.lawCode==='FIFA_FUTSAL_2026_27'&&timing.phase==='NOT_STARTED'&&['YELLOW_CARD','SECOND_YELLOW_CARD'].includes(input.eventType))throw new AppError(409,'Futsal: cảnh cáo trước trận được ghi vào báo cáo/sự cố, không cộng thẻ vàng trong trận.','PREMATCH_CAUTION_IS_REPORT');
 if(!PLAYING_CLOCK_PHASES.includes(timing.phase)&&!passive&&!['SUBSTITUTION_OUT','REPLACEMENT_IN'].includes(input.eventType))throw new AppError(409,'Sự kiện thi đấu phải thuộc một hiệp hợp lệ.','EVENT_PHASE_INVALID');
 if(input.playerId&&!players.some(p=>p.playerId===input.playerId&&p.teamId===input.teamId))throw new AppError(400,'Cầu thủ ngoài đội hình trận của đội.','PLAYER_NOT_IN_LINEUP');
 if(input.eventType!=='INCIDENT'&&!input.playerId)throw new AppError(400,'Cần chọn cầu thủ trong đội hình trận.','EVENT_PLAYER_REQUIRED');
 const removed=previous?(await c.query('SELECT * FROM match_events WHERE id=$1 OR (substitution_id IS NOT NULL AND substitution_id=$2) ORDER BY event_sequence',[previous.id,previous.substitution_id])).rows:[];
 const old=(await c.query('SELECT * FROM match_events WHERE match_id=$1 AND voided_at IS NULL ORDER BY event_sequence',[input.matchId])).rows.filter(e=>!removed.some(r=>r.id===e.id)).map(mapEvent);
 const substitutionId=input.eventType==='SUBSTITUTION_OUT'?randomUUID():null,operationId=input.operationId??randomUUID();
 let opportunityId:string|null=substitutionId;
 if(input.opportunityId){const existing=old.find(e=>e.opportunityId===input.opportunityId&&e.teamId===input.teamId)??(previous?.opportunity_id===input.opportunityId?mapEvent(previous):undefined);if(!existing||existing.phase!==timing.phase||existing.periodElapsedSeconds!==timing.periodElapsedSeconds||existing.teamId!==input.teamId)throw new AppError(409,'Cơ hội thay người phải thuộc cùng đội, hiệp và thời điểm đã ghi.','SUBSTITUTION_OPPORTUNITY_INVALID');opportunityId=input.opportunityId;}
 const inserted:MatchEvent[]=[];
 for(const pair of substitutionId?[{type:'SUBSTITUTION_OUT',player:input.playerId,related:input.relatedPlayerId},{type:'SUBSTITUTION_IN',player:input.relatedPlayerId,related:input.playerId}]:[{type:input.eventType,player:input.playerId,related:input.eventType==='REPLACEMENT_IN'?input.relatedPlayerId:null}]){
 const prior=removed.find(r=>r.event_type===pair.type)??(pair.type==='SUBSTITUTION_IN'?undefined:previous);
 const r=(await c.query(`INSERT INTO match_events(match_id,team_id,player_id,event_type,minute,description,created_by,phase,period_elapsed_seconds,added_time_seconds,operation_id,request_hash,substitution_id,related_player_id,opportunity_id,visibility,supersedes_event_id,logical_sequence,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,[input.matchId,input.teamId,pair.player??null,pair.type,timing.minute,input.description??null,actor,timing.phase,timing.periodElapsedSeconds,timing.addedTimeSeconds,operationId,requestHash,substitutionId,pair.related,opportunityId,input.visibility??'PUBLIC',prior?.id??null,prior?.logical_sequence??prior?.event_sequence??null,previous?previous.revision+1:1])).rows[0];inserted.push(mapEvent(r));
 }
 assertChain(players,[...old,...inserted],{...rules.rules.values,extraTimeMinutes:rules.extraTimeMinutes});
 for(const r of removed){await c.query('UPDATE match_events SET voided_at=NOW(),voided_by=$2,void_reason=$3,revision=revision+1 WHERE id=$1',[r.id,actor,input.correctionReason]);await c.query("INSERT INTO match_event_history(event_id,match_id,action,event_snapshot,actor_id,reason) VALUES($1,$2,'VOIDED',$3::jsonb,$4,$5)",[r.id,input.matchId,JSON.stringify({...r,replacedBy:inserted.map(e=>e.id)}),actor,input.correctionReason]);if(cardTypes.includes(r.event_type))await c.query("INSERT INTO match_event_discipline_outbox(event_id,action,payload) VALUES($1,'VOID_CARD',$2::jsonb) ON CONFLICT(event_id,action) DO NOTHING",[r.id,JSON.stringify({eventId:r.id,actorId:actor,reason:input.correctionReason})]);}
 for(const event of inserted){await c.query("INSERT INTO match_event_history(event_id,match_id,action,event_snapshot,actor_id) VALUES($1,$2,'CREATED',$3::jsonb,$4)",[event.id,event.matchId,JSON.stringify(event),actor]);if(cardTypes.includes(event.eventType))await c.query("INSERT INTO match_event_discipline_outbox(event_id,action,payload) VALUES($1,'ISSUE_CARD',$2::jsonb) ON CONFLICT(event_id,action) DO NOTHING",[event.id,JSON.stringify({eventId:event.id,playerId:event.playerId,matchId:event.matchId,tournamentId:m.tournament_id,teamId:event.teamId,cardType:event.eventType==='RED_CARD'?'RED':'YELLOW',minute:event.minute,reason:event.description,issuedBy:actor})]);}
 if(m.status==='FINISHED'&&(await c.query('SELECT timing_model_version FROM match_clock_states WHERE match_id=$1',[input.matchId])).rows[0]?.timing_model_version===1)await saveFinishedOutcome(c,input.matchId,actor,new Date());
 await publishMatchUpdate(c,input.matchId,'match.event.created');await c.query('COMMIT');return inserted[0];
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function voidRecordedEvent(id:string,actor:string,reason:string,expectedRevision?:number):Promise<boolean>{
 if(expectedRevision!=null&&(!Number.isInteger(expectedRevision)||expectedRevision<1))throw new AppError(400,'Phiên bản sự kiện không hợp lệ.','VALIDATION_ERROR');
 const c=await getPool().connect();try{await c.query('BEGIN');
 const ref=(await c.query('SELECT match_id FROM match_events WHERE id=$1',[id])).rows[0];if(!ref){await c.query('ROLLBACK');return false;}
 const m=(await c.query('SELECT status FROM matches WHERE id=$1 FOR UPDATE',[ref.match_id])).rows[0];
 const row=(await c.query('SELECT * FROM match_events WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(row.voided_at){await c.query('COMMIT');return true;}
 if(expectedRevision!=null&&row.revision!==expectedRevision)throw new AppError(409,'Sự kiện đã đổi trên thiết bị khác.','EVENT_VERSION_CONFLICT');
 if(!['LINEUP_CONFIRMED','IN_PROGRESS','FINISHED'].includes(m.status)||(await c.query("SELECT 1 FROM match_reports WHERE match_id=$1 AND status IN ('PENDING','APPROVED')",[ref.match_id])).rowCount)throw new AppError(409,'Sự kiện đã khóa theo biên bản/trạng thái trận.','MATCH_EVENT_LOCKED');
 if((await c.query('SELECT 1 FROM match_shootouts WHERE match_id=$1',[ref.match_id])).rowCount&&row.phase!=='PENALTIES')throw new AppError(409,'Luân lưu đã thiết lập; không hủy nguồn trước loạt sút qua luồng thông thường.','SHOOTOUT_SOURCE_LOCKED');
 const removed=(await c.query('SELECT * FROM match_events WHERE id=$1 OR (substitution_id IS NOT NULL AND substitution_id=$2)',[id,row.substitution_id])).rows;
 const events=(await c.query('SELECT * FROM match_events WHERE match_id=$1 AND voided_at IS NULL ORDER BY event_sequence',[ref.match_id])).rows.filter(e=>!removed.some(x=>x.id===e.id)).map(mapEvent);
 const players=(await c.query('SELECT player_id AS "playerId",team_id AS "teamId",is_starting AS "isStarting" FROM lineups WHERE match_id=$1',[ref.match_id])).rows;
 const rules=await getEffectiveMatchRules(ref.match_id,c);assertChain(players,events,{...rules.rules.values,extraTimeMinutes:rules.extraTimeMinutes});
 for(const r of removed){await c.query('UPDATE match_events SET voided_at=NOW(),voided_by=$2,void_reason=$3,revision=revision+1 WHERE id=$1 AND voided_at IS NULL',[r.id,actor,reason]);await c.query("INSERT INTO match_event_history(event_id,match_id,action,event_snapshot,actor_id,reason) VALUES($1,$2,'VOIDED',$3::jsonb,$4,$5)",[r.id,ref.match_id,JSON.stringify(r),actor,reason]);if(cardTypes.includes(r.event_type))await c.query("INSERT INTO match_event_discipline_outbox(event_id,action,payload) VALUES($1,'VOID_CARD',$2::jsonb) ON CONFLICT(event_id,action) DO NOTHING",[r.id,JSON.stringify({eventId:r.id,actorId:actor,reason})]);}
 if(m.status==='FINISHED'&&(await c.query('SELECT timing_model_version FROM match_clock_states WHERE match_id=$1',[ref.match_id])).rows[0]?.timing_model_version===1)await saveFinishedOutcome(c,ref.match_id,actor,new Date());
 await publishMatchUpdate(c,ref.match_id,'match.event.voided');await c.query('COMMIT');return true;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}

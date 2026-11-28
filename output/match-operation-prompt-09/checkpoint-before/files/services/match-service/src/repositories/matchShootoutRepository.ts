import {createHash,randomUUID} from 'crypto';
import type {PoolClient} from 'pg';
import {projectMatchPlayers,projectShootout,ShootoutError,type ShootoutData,type ShootoutAttempt} from '@sfl/shared';
import {getPool} from '../lib/db';
import {AppError} from '../lib/errors';
import {getEffectiveMatchRules,assertClockRuleAction} from '../services/matchOperationRulesService';
import {publishMatchUpdate} from '../realtime/matchRealtime';
import {stageOutcome} from './matchOutcomeRepository';
type Query=Pick<PoolClient,'query'>;
const uuid=(x:unknown)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const denied=(message:string,code='SHOOTOUT_INVALID'):never=>{throw new AppError(409,message,code);};
async function candidates(matchId:string,c:Query){
 const rules=await getEffectiveMatchRules(matchId,c);
 if(!['IFAB_2026_27','VFF_7_433_2023','FIFA_FUTSAL_2026_27'].includes(rules.rules.lawCode??''))denied('Bộ luật đã khai báo chưa xác định đủ quy trình và điều kiện luân lưu. Không tự áp dụng luật khác.','SHOOTOUT_POLICY_UNDEFINED');
 const players=(await c.query('SELECT player_id AS "playerId",team_id AS "teamId",is_starting AS "isStarting",position,jersey_number AS "jerseyNumber" FROM lineups WHERE match_id=$1',[matchId])).rows;
 const events=(await c.query('SELECT team_id AS "teamId",player_id AS "playerId",event_type AS "eventType",phase,substitution_id AS "substitutionId",related_player_id AS "relatedPlayerId",opportunity_id AS "opportunityId",period_elapsed_seconds AS "periodElapsedSeconds",COALESCE(logical_sequence,event_sequence)::text AS "eventSequence" FROM match_events WHERE match_id=$1 AND voided_at IS NULL ORDER BY event_sequence',[matchId])).rows;
 let active:ReturnType<typeof projectMatchPlayers>;try{active=projectMatchPlayers(players,events,{...rules.rules.values,extraTimeMinutes:rules.extraTimeMinutes});}catch(e){throw new AppError(409,e instanceof Error?e.message:'Chuỗi sự kiện cần được kiểm tra.','EVENT_CHAIN_INVALID');}
 const futsal=rules.rules.lawCode==='FIFA_FUTSAL_2026_27';
 const eligible=players.filter(p=>!active.dismissed.has(p.playerId)&&(futsal?!(active.temporarilyOff.has(p.playerId)&&events.some(e=>e.playerId===p.playerId&&e.eventType==='INJURY')):active.onField.has(p.playerId)||active.temporarilyOff.has(p.playerId)));
 return {rules,players,events,active,eligible,futsal};
}
export async function getMatchShootout(matchId:string,c:Query=getPool()){
 const row=(await c.query('SELECT version,state FROM match_shootouts WHERE match_id=$1',[matchId])).rows[0];
 if(!row)return null;
 const state=row.state as ShootoutData;
 return {version:row.version,...state,...projectShootout(state)};
}
export async function getShootoutWorkspace(matchId:string,c:Query=getPool()){
 const clock=(await c.query('SELECT phase FROM match_clock_states WHERE match_id=$1',[matchId])).rows[0];
 const current=await getMatchShootout(matchId,c);
 if(clock?.phase!=='PENALTIES')return current?{current,candidates:[],requiresEqualNumbers:false,issues:[] as string[]}:null;
 let source:Awaited<ReturnType<typeof candidates>>;try{source=await candidates(matchId,c);}catch(e){if(e instanceof AppError&&['SHOOTOUT_POLICY_UNDEFINED','EVENT_CHAIN_INVALID'].includes(e.code))return {current,candidates:[],requiresEqualNumbers:false,issues:[e.message]};throw e;}const issues:string[]=[];
 if(current){for(const team of [current.homeId,current.awayId]){
  if(current.eligible[team].some(id=>source.active.dismissed.has(id)))issues.push('Có cầu thủ bị truất quyền trong danh sách luân lưu; cần cập nhật danh sách.');
  if(!current.eligible[team].includes(current.keepers[team]))issues.push('Cần xác định thủ môn hợp lệ.');
 }if(!source.futsal&&current.eligible[current.homeId].length!==current.eligible[current.awayId].length)issues.push('Hai đội cần cân bằng số cầu thủ luân lưu.');}
 return {current,candidates:source.eligible.map(p=>({playerId:p.playerId,teamId:p.teamId,jerseyNumber:p.jerseyNumber,position:p.position})),requiresEqualNumbers:!source.futsal,issues};
}
export type ShootoutCommand={action:'SETUP'|'KICK'|'RETAKE'|'CORRECT'|'VOID_LAST'|'ELIGIBILITY'|'REPLACE_KEEPER';operationId:string;expectedVersion:number;expectedClockVersion:number;firstTeamId?:string;eligiblePlayerIds?:string[];unavailablePlayerIds?:string[];keepers?:Record<string,string>;playerId?:string;scored?:boolean;attemptId?:string;reason?:string;teamId?:string;replacedPlayerId?:string};
/** Caller holds the existing Scheduling operation lease/capability check. */
export async function changeShootout(matchId:string,input:ShootoutCommand,actorId:string){
 if(!uuid(input.operationId)||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||!Number.isSafeInteger(input.expectedClockVersion)||input.expectedClockVersion<0)throw new AppError(400,'Thiếu mã thao tác hoặc phiên bản hợp lệ.','SHOOTOUT_INPUT_INVALID');
 if(!['SETUP','KICK','RETAKE','CORRECT','VOID_LAST','ELIGIBILITY','REPLACE_KEEPER'].includes(input.action))throw new AppError(400,'Thao tác luân lưu không được hỗ trợ.','SHOOTOUT_INPUT_INVALID');
 if(!['SETUP','KICK'].includes(input.action)&&(typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>2000))throw new AppError(400,'Cần lý do từ 5 đến 2000 ký tự.','SHOOTOUT_REASON_REQUIRED');
 const c=await getPool().connect();try{await c.query('BEGIN');
 const m=(await c.query('SELECT * FROM matches WHERE id=$1 FOR UPDATE',[matchId])).rows[0];if(!m)throw new AppError(404,'Không tìm thấy trận.','MATCH_NOT_FOUND');
 const hash=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(input).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
 const prior=(await c.query('SELECT * FROM match_shootout_history WHERE match_id=$1 AND operation_id=$2',[matchId,input.operationId])).rows[0];
 if(prior){if(prior.request_hash!==hash||prior.actor_id!==actorId)denied('Mã thao tác đã dùng cho nội dung khác.','SHOOTOUT_IDEMPOTENCY_CONFLICT');const result={version:prior.version,...prior.after_snapshot,...projectShootout(prior.after_snapshot)};await c.query('COMMIT');return result;}
 const clock=(await c.query('SELECT * FROM match_clock_states WHERE match_id=$1 FOR UPDATE',[matchId])).rows[0];
 if(m.status!=='IN_PROGRESS'||clock?.phase!=='PENALTIES'||clock.is_running||clock.timing_model_version!==1)denied('Chỉ ghi nhận luân lưu trong giai đoạn luân lưu đang diễn ra.','SHOOTOUT_PHASE_REQUIRED');
 if(clock.version!==input.expectedClockVersion)denied('Đồng hồ đã thay đổi; hãy tải trạng thái mới.','CLOCK_VERSION_CONFLICT');
 if((await c.query("SELECT 1 FROM match_reports WHERE match_id=$1 AND status IN ('PENDING','APPROVED')",[matchId])).rowCount)denied('Biên bản đã khóa tác nghiệp.','MATCH_RESULT_LOCKED');
 const old=(await c.query('SELECT version,state FROM match_shootouts WHERE match_id=$1 FOR UPDATE',[matchId])).rows[0];
 if((old?.version??0)!==input.expectedVersion)denied('Loạt luân lưu vừa thay đổi; hãy tải lại.','SHOOTOUT_VERSION_CONFLICT');
 const source=await candidates(matchId,c);assertClockRuleAction(source.rules,'START_PENALTIES',source.rules.decisionMethod==='EXTRA_TIME_THEN_PENALTIES'?'EXTRA_TIME_COMPLETE':'REGULATION_COMPLETE');
 const outcome=await stageOutcome(matchId,c);if(outcome.total.home!==outcome.total.away)denied('Tỷ số thi đấu không hòa.','MATCH_NOT_TIED');
 let state:ShootoutData=old?structuredClone(old.state):{homeId:m.home_team_id,awayId:m.away_team_id,firstTeamId:input.firstTeamId!,initialKicks:Number(source.rules.rules.values.shootoutKicks),eligible:{},keepers:{},cycleIds:{},unavailable:[],attempts:[]};
 const teams=[state.homeId,state.awayId];
 if(input.action==='SETUP'||input.action==='ELIGIBILITY'){
  if(input.action==='SETUP'&&old)denied('Loạt luân lưu đã được thiết lập.','SHOOTOUT_ALREADY_CONFIGURED');
  if(!Array.isArray(input.eligiblePlayerIds)||!input.eligiblePlayerIds.every(uuid)||new Set(input.eligiblePlayerIds).size!==input.eligiblePlayerIds.length||!input.keepers)denied('Chọn danh sách cầu thủ và thủ môn hợp lệ.');
  const available=new Set([...source.eligible.map(p=>p.playerId),...Object.values(state.eligible).flat()].filter(id=>!source.active.dismissed.has(id)));
  const withdrawn=input.unavailablePlayerIds??[];
  if(!Array.isArray(withdrawn)||!withdrawn.every(uuid)||withdrawn.some(id=>!available.has(id))||withdrawn.length&&(!input.reason||input.reason.trim().length<5))denied('Cầu thủ không thể tiếp tục cần định danh và lý do xác nhận thực tế.','SHOOTOUT_WITHDRAWAL_REQUIRED');
  state.unavailable=[...new Set([...state.unavailable,...withdrawn])];
  if(input.eligiblePlayerIds!.some(id=>!available.has(id)||state.unavailable.includes(id)))denied('Có cầu thủ không đủ điều kiện tham gia loạt sút.','SHOOTOUT_PLAYER_INELIGIBLE');
  if(old&&input.eligiblePlayerIds!.some(id=>!state.eligible[source.players.find(p=>p.playerId===id)?.teamId]?.includes(id)))denied('Không đưa lại cầu thủ đã loại hoặc thêm người ngoài danh sách. Thay thủ môn dùng thao tác riêng.');
  const possible=Object.fromEntries(teams.map(team=>[team,(old?state.eligible[team]:source.eligible.filter(p=>p.teamId===team).map(p=>p.playerId)).filter(id=>available.has(id)&&!state.unavailable.includes(id))]));
  const target=Math.min(...teams.map(t=>possible[t].length));
  for(const team of teams){const count=input.eligiblePlayerIds!.filter(id=>possible[team].includes(id)).length;
   if(!source.futsal&&count!==target||source.futsal&&count!==possible[team].length&&count!==target)denied('Chỉ loại để cân bằng với đội ít người hơn, hoặc ghi nhận cầu thủ không thể tiếp tục có lý do.','SHOOTOUT_EQUAL_NUMBERS_REQUIRED');}
  for(const team of teams){state.eligible[team]=input.eligiblePlayerIds!.filter(id=>source.players.some(p=>p.teamId===team&&p.playerId===id));state.keepers[team]=input.keepers![team];for(const id of state.eligible[team])state.cycleIds[id]??=id;}
 }else{
  if(!old)denied('Chưa thiết lập đội sút trước và danh sách đủ điều kiện.','SHOOTOUT_SETUP_REQUIRED');
  const projection=projectShootout(state);
  if(input.action==='KICK'){
   if(projection.winnerTeamId)denied('Loạt sút đã xác định đội thắng. Chỉ được đính chính có lý do.','SHOOTOUT_COMPLETE');
   if(typeof input.scored!=='boolean'||!uuid(input.playerId)||!projection.nextPlayerIds.includes(input.playerId!))denied('Cầu thủ chưa đủ điều kiện thực hiện lượt kế tiếp.','SHOOTOUT_PLAYER_INELIGIBLE');
   const pending=state.attempts.filter(a=>a.outcome!=='VOID').at(-1);
   state.attempts.push({id:randomUUID(),turn:projection.nextTurn,attempt:projection.retakePending?pending!.attempt+1:1,teamId:projection.nextTeamId!,playerId:input.playerId!,cycleId:state.cycleIds[input.playerId!]??input.playerId!,eligibleCycleIds:state.eligible[projection.nextTeamId!].map(id=>state.cycleIds[id]??id),outcome:input.scored?'SCORED':'MISSED',recordedBy:actorId,recordedAt:new Date().toISOString()});
  }else if(['CORRECT','RETAKE','VOID_LAST'].includes(input.action)){
   const last=state.attempts.filter(k=>!['VOID','RETAKE'].includes(k.outcome)).at(-1),kick=state.attempts.find(k=>k.id===input.attemptId);
   if(!kick||['VOID','RETAKE'].includes(kick.outcome))denied('Lượt sút không còn hiệu lực.','SHOOTOUT_ATTEMPT_NOT_FOUND');
   if(input.action!=='CORRECT'&&kick!==last)denied('Cần xử lý từ lượt cuối để giữ đúng trình tự.','SHOOTOUT_CHAIN_INVALID');
   if(input.action==='CORRECT'){if(typeof input.scored!=='boolean')denied('Chọn kết quả đính chính.');kick!.outcome=input.scored?'SCORED':'MISSED';}
   if(input.action==='RETAKE')kick!.outcome='RETAKE';
   if(input.action==='VOID_LAST'){for(const a of state.attempts.filter(a=>a.turn===kick!.turn))a.outcome='VOID';}
  }else if(input.action==='REPLACE_KEEPER'){
   const team=input.teamId!,oldKeeper=state.keepers[team],incoming=input.playerId!,oldEligible=state.eligible[team]??[];
   if(!teams.includes(team)||input.replacedPlayerId!==oldKeeper||!uuid(incoming)||incoming===oldKeeper)denied('Chọn thủ môn hiện tại và người thay hợp lệ.');
   const incomingPlayer=source.players.find(p=>p.teamId===team&&p.playerId===incoming);
   if(!incomingPlayer||source.active.dismissed.has(incoming)||state.unavailable.includes(incoming))denied('Người thay thủ môn không đủ điều kiện.','SHOOTOUT_PLAYER_INELIGIBLE');
   const dismissed=source.active.dismissed.has(oldKeeper);
   if(dismissed&&!oldEligible.includes(incoming))denied('Thủ môn bị đuổi chỉ được thay bởi cầu thủ còn đủ điều kiện.');
   if(!oldEligible.includes(incoming)){
    const excluded=source.eligible.some(p=>p.playerId===incoming);
    const remaining=Number(source.rules.rules.values.maxSubstitutions)-Number(source.active.substitutions.get(team)??0)-Number(state.keeperSubstitutions?.[team]??0)+(outcome.extraStarted?Number(source.rules.rules.values.extraTimeSubstitutions??0):0);
    if(!source.futsal&&!excluded&&(incomingPlayer.isStarting||source.active.used.has(incoming)||!(remaining>0)))denied('Không còn quyền thay thủ môn bằng dự bị hoặc người này không phải dự bị chưa sử dụng.');
    if(source.futsal&&!excluded)denied('Người thay phải là cầu thủ đủ điều kiện hoặc người đã loại để cân bằng.');
    state.eligible[team]=oldEligible.map(id=>id===oldKeeper?incoming:id);
    const oldCycle=state.cycleIds[oldKeeper]??oldKeeper,incomingCycle=state.cycleIds[incoming]??incoming;
    state.cycleIds[incoming]=(projection.counts[incomingCycle]??0)>(projection.counts[oldCycle]??0)?incomingCycle:oldCycle;
    if(!source.futsal&&!excluded){state.keeperSubstitutions??={};state.keeperSubstitutions[team]=(state.keeperSubstitutions[team]??0)+1;}
   }else state.eligible[team]=oldEligible.filter(id=>id!==oldKeeper);
   state.unavailable.push(oldKeeper);state.keepers[team]=incoming;
   // A simultaneous, explicit reduction of the opposing pool avoids an invalid intermediate state.
   if(input.eligiblePlayerIds){if(!Array.isArray(input.eligiblePlayerIds)||!input.eligiblePlayerIds.every(uuid))denied('Danh sách cân bằng không hợp lệ.');for(const other of teams.filter(t=>t!==team))state.eligible[other]=state.eligible[other].filter(id=>input.eligiblePlayerIds!.includes(id));}
  }
 }
 for(const team of teams){if(!state.eligible[team]?.length||!state.eligible[team].includes(state.keepers[team])||state.eligible[team].some(id=>source.active.dismissed.has(id)))denied('Cần loại cầu thủ bị đuổi và xác định thủ môn đủ điều kiện.','SHOOTOUT_ELIGIBILITY_REVIEW');}
 if(!source.futsal&&state.eligible[state.homeId].length!==state.eligible[state.awayId].length)denied('Phải cân bằng số người hai đội trước khi tiếp tục.','SHOOTOUT_EQUAL_NUMBERS_REQUIRED');
 const projected=projectShootout(state),version=(old?.version??0)+1;
 await c.query('INSERT INTO match_shootouts(match_id,version,state,updated_by) VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(match_id) DO UPDATE SET version=$2,state=$3::jsonb,updated_by=$4,updated_at=NOW()',[matchId,version,JSON.stringify(state),actorId]);
 await c.query('INSERT INTO match_shootout_history(match_id,version,operation_id,request_hash,action,actor_id,reason,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)',[matchId,version,input.operationId,hash,input.action,actorId,input.reason?.trim()??null,old?JSON.stringify(old.state):null,JSON.stringify(state)]);
 await publishMatchUpdate(c,matchId,'match.shootout.changed');await c.query('COMMIT');return {version,...state,...projected};
 }catch(e){await c.query('ROLLBACK');if(e instanceof ShootoutError)throw new AppError(409,e.message,e.code);throw e;}finally{c.release();}
}

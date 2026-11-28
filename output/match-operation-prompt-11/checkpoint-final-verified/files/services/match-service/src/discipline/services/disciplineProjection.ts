import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool as matchPool } from '../../lib/db';
import { getPool as disciplinePool } from '../lib/db';
import { AppError } from '../../lib/errors';
import { cardPolicy, type CardPolicy } from '../../services/competitionPolicies';
import { getEffectiveMatchRules } from '../../services/matchOperationRulesService';
type Row=Record<string,any>;
export type PolicyCard={id:string;matchId:string;teamId:string;stage:string;phase:string;kind:string;date:string;sequence:number;actor:string;policy:CardPolicy};
export type ProjectedBan={key:string;anchor:PolicyCard;type:'YELLOW_CARDS'|'RED_CARD';count:number;sourceIds:string[];served:string[]};
export type ServedFixture={id:string;teamIds:string[];date:string;stage:string;official:boolean;fieldPlayed:boolean;playerRegistered:boolean};
const missing=(message:string):never=>{throw new AppError(409,message,'DISCIPLINE_RULES_UNDEFINED');};

/** Rebuild, never increment/decrement counters: deterministic under retry and void. */
export function projectCardBans(cards:PolicyCard[],fixtures:ServedFixture[]):ProjectedBan[]{
 const ordered=[...cards].sort((a,b)=>a.date.localeCompare(b.date)||a.matchId.localeCompare(b.matchId)||a.sequence-b.sequence||a.id.localeCompare(b.id)),bans:ProjectedBan[]=[],yellow:PolicyCard[]=[];
 let stage:string|null=null;
 for(const card of ordered){
  if(stage!==card.stage&&(card.policy.reset==='RESET_EACH_STAGE'||card.policy.reset==='RESET_BEFORE_KNOCKOUT'&&card.stage==='KNOCKOUT'))yellow.length=0;
  stage=card.stage;
  if(card.phase==='PENALTIES'){
   if(!['CARRY_CARDS','RED_ONLY'].includes(card.policy.shootoutDiscipline??''))missing('Điều lệ chưa xác định việc chuyển thẻ trong loạt luân lưu sang kỷ luật trận sau.');
   if(card.policy.shootoutDiscipline==='RED_ONLY'&&card.kind==='YELLOW_CARD')continue;
  }
  const matchCards=ordered.filter(c=>c.matchId===card.matchId),second=matchCards.some(c=>c.kind==='SECOND_YELLOW_CARD');
  if(card.kind==='YELLOW_CARD'){
   if(second&&card.policy.yellowThreshold>0&&!['COUNT_FIRST','EXCLUDE_MATCH'].includes(card.policy.secondYellowAccumulation??''))missing('Điều lệ chưa xác định vàng tích lũy trong trận có hai thẻ vàng dẫn đến truất quyền.');
   if(second&&card.policy.secondYellowAccumulation==='EXCLUDE_MATCH')continue;
   if(!second&&matchCards.some(c=>c.kind==='RED_CARD')&&card.policy.yellowThreshold>0){
    if(!['COUNT_FIRST','EXCLUDE_MATCH'].includes(card.policy.directRedYellowAccumulation??''))missing('Điều lệ chưa xác định vàng tích lũy trong trận có thẻ vàng và đỏ trực tiếp.');
    if(card.policy.directRedYellowAccumulation==='EXCLUDE_MATCH')continue;
   }
   yellow.push(card);
   if(card.policy.yellowThreshold>0&&yellow.length>=card.policy.yellowThreshold){const used=yellow.splice(0,card.policy.yellowThreshold);bans.push({key:'yellow:'+card.id,anchor:card,type:'YELLOW_CARDS',count:card.policy.yellowBan,sourceIds:used.map(c=>c.id),served:[]});}
  }else{
   const count=card.kind==='RED_CARD'?card.policy.directRedBan:card.policy.secondYellowBan;
   if(count>0)bans.push({key:card.kind+':'+card.id,anchor:card,type:'RED_CARD',count,sourceIds:matchCards.filter(c=>c.kind!== 'YELLOW_CARD'||second).map(c=>c.id),served:[]});
  }
 }
 const consumed=new Set<string>();
 for(const ban of bans){
  const applicable=fixtures.filter(f=>f.official&&f.fieldPlayed&&!f.playerRegistered&&f.id!==ban.anchor.matchId&&f.teamIds.includes(ban.anchor.teamId)&&f.date>ban.anchor.date&&(ban.anchor.policy.scope!=='STAGE'||f.stage===ban.anchor.stage)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  const simultaneous=bans.some(other=>other!==ban&&other.anchor.date<=ban.anchor.date&&other.count>other.served.length);
  if(simultaneous&&!['SEQUENTIAL','CONCURRENT'].includes(ban.anchor.policy.concurrentSanctions??''))missing('Điều lệ chưa xác định cách thi hành nhiều án đồng thời.');
  ban.served=applicable.filter(f=>ban.anchor.policy.concurrentSanctions!=='SEQUENTIAL'||!consumed.has(f.id)).slice(0,ban.count).map(f=>f.id);
  if(ban.anchor.policy.concurrentSanctions==='SEQUENTIAL')ban.served.forEach(id=>consumed.add(id));
 }
 return bans;
}

export async function reconcilePlayerDiscipline(tournamentId:string,playerId:string){
 const q=matchPool();
 const source=(await q.query(`SELECT e.*,m.tournament_id,m.stage,COALESCE(clock.actual_started_at,m.match_date) AS source_date
  FROM match_events e JOIN matches m ON m.id=e.match_id LEFT JOIN match_clock_states clock ON clock.match_id=m.id
  WHERE m.tournament_id=$1 AND e.player_id=$2 AND e.event_type IN ('YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD') ORDER BY source_date,e.logical_sequence,e.event_sequence`,[tournamentId,playerId])).rows;
 const policies=new Map<string,CardPolicy>();
 for(const e of source.filter(e=>!e.voided_at))if(!policies.has(e.match_id))policies.set(e.match_id,cardPolicy(await getEffectiveMatchRules(e.match_id)));
 const active:PolicyCard[]=source.filter(e=>!e.voided_at).map(e=>{
  if(!e.source_date||!e.phase||!e.stage)throw new AppError(409,'Thẻ cũ thiếu ngày/pha/giai đoạn; cần đối chiếu có thẩm quyền trước khi tính án.','DISCIPLINE_SOURCE_REVIEW_REQUIRED');
  return {id:e.id,matchId:e.match_id,teamId:e.team_id,stage:e.stage,phase:e.phase,kind:e.event_type,date:new Date(e.source_date).toISOString(),sequence:Number(e.logical_sequence??e.event_sequence),actor:e.created_by,policy:policies.get(e.match_id)!};
 });
 const matches=(await q.query(`SELECT m.*,r.status AS result_status,r.result_origin,c.actual_started_at,c.actual_ended_at,
  EXISTS(SELECT 1 FROM match_forfeit_decisions f WHERE f.match_id=m.id) AS forfeit,
  EXISTS(SELECT 1 FROM lineups l WHERE l.match_id=m.id AND l.player_id=$2) AS registered
  FROM matches m LEFT JOIN match_results r ON r.match_id=m.id LEFT JOIN match_clock_states c ON c.match_id=m.id WHERE m.tournament_id=$1`,[tournamentId,playerId])).rows;
 const fixtures:ServedFixture[]=matches.map(m=>({id:m.id,teamIds:[m.home_team_id,m.away_team_id],date:m.actual_started_at?new Date(m.actual_started_at).toISOString():m.match_date?new Date(m.match_date).toISOString():'',stage:m.stage,official:['VERIFIED','LOCKED'].includes(m.status)&&m.result_status==='APPROVED',fieldPlayed:!m.forfeit&&['FIELD','CORRECTION'].includes(m.result_origin)&&!!m.actual_started_at&&!!m.actual_ended_at,playerRegistered:m.registered}));
 const bans=projectCardBans(active,fixtures),c=await disciplinePool().connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,9))',[tournamentId+':'+playerId]);
  for(const e of source){
   const policy=policies.get(e.match_id)??null;
   await c.query(`INSERT INTO cards(player_id,match_id,tournament_id,team_id,card_type,minute,reason,issued_by,source_event_id,event_kind,event_phase,source_match_date,source_stage,rule_snapshot,voided_at,voided_by,void_reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17) ON CONFLICT(source_event_id) DO UPDATE SET
    event_kind=EXCLUDED.event_kind,event_phase=EXCLUDED.event_phase,source_match_date=EXCLUDED.source_match_date,source_stage=EXCLUDED.source_stage,rule_snapshot=EXCLUDED.rule_snapshot,
    voided_at=EXCLUDED.voided_at,voided_by=EXCLUDED.voided_by,void_reason=EXCLUDED.void_reason`,
    [playerId,e.match_id,tournamentId,e.team_id,e.event_type==='RED_CARD'?'RED':'YELLOW',e.minute,e.description,e.created_by,e.id,e.event_type,e.phase,e.source_date,e.stage,JSON.stringify(policy),e.voided_at,e.voided_by,e.void_reason]);
  }
  const legacy=(await c.query(`SELECT s.id FROM suspensions s JOIN cards card ON card.id=s.source_card_id WHERE s.player_id=$1 AND s.tournament_id=$2 AND s.projection_key IS NULL AND s.is_active AND card.source_event_id=ANY($3::uuid[])`,[playerId,tournamentId,active.map(e=>e.id)])).rows;
  if(legacy.length)throw new AppError(409,'Án tự động cũ cần đối chiếu trước khi chuyển cách tính; không tự ghi đè án đã xác lập.','DISCIPLINE_LEGACY_REVIEW_REQUIRED');
  await c.query("UPDATE suspensions SET is_active=FALSE,status_reason='SOURCE_VOID_OR_REPLACED',served_match_ids='{}' WHERE player_id=$1 AND tournament_id=$2 AND projection_key IS NOT NULL",[playerId,tournamentId]);
  for(const ban of bans){
   const card=(await c.query('SELECT id FROM cards WHERE source_event_id=$1',[ban.anchor.id])).rows[0];
   await c.query(`INSERT INTO suspensions(player_id,tournament_id,team_id,type,start_date,end_date,reason,match_id,issued_by,source_card_id,matches_suspended,
    projection_key,source_event_ids,scope_stage,status_reason,served_match_ids,rule_snapshot,is_active)
    VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17)
    ON CONFLICT(projection_key) DO UPDATE SET matches_suspended=EXCLUDED.matches_suspended,source_event_ids=EXCLUDED.source_event_ids,scope_stage=EXCLUDED.scope_stage,
    served_match_ids=EXCLUDED.served_match_ids,rule_snapshot=EXCLUDED.rule_snapshot,status_reason=CASE WHEN suspensions.manually_lifted THEN 'MANUALLY_LIFTED' ELSE EXCLUDED.status_reason END,is_active=EXCLUDED.is_active AND NOT suspensions.manually_lifted`,
    [playerId,tournamentId,ban.anchor.teamId,ban.type,ban.anchor.date,ban.type==='YELLOW_CARDS'?'Tích lũy thẻ vàng theo điều lệ':ban.anchor.kind==='SECOND_YELLOW_CARD'?'Hai thẻ vàng trong một trận':'Thẻ đỏ trực tiếp',ban.anchor.matchId,ban.anchor.actor,card.id,ban.count,ban.key,ban.sourceIds,ban.anchor.policy.scope==='STAGE'?ban.anchor.stage:null,ban.served.length>=ban.count?'COMPLETED':'MATCHES_REMAINING',ban.served,JSON.stringify(ban.anchor.policy),ban.served.length<ban.count]);
  }
  const manual=(await c.query('SELECT * FROM suspensions WHERE player_id=$1 AND tournament_id=$2 AND projection_key IS NULL AND source_card_id IS NULL AND matches_suspended IS NOT NULL AND NOT manually_lifted',[playerId,tournamentId])).rows;
  for(const ban of manual){
   const anchor=matches.find(m=>m.id===ban.match_id),start=anchor?.actual_started_at??anchor?.match_date??ban.start_date;
   const served=fixtures.filter(f=>f.official&&f.fieldPlayed&&!f.playerRegistered&&f.id!==ban.match_id&&f.teamIds.includes(ban.team_id)&&f.date>new Date(start).toISOString()).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,ban.matches_suspended).map(f=>f.id);
   await c.query('UPDATE suspensions SET served_match_ids=$2,is_active=$3,status_reason=$4 WHERE id=$1',[ban.id,served,served.length<ban.matches_suspended,served.length>=ban.matches_suspended?'COMPLETED':'MATCHES_REMAINING']);
  }
  const snapshot=(await c.query('SELECT projection_key,matches_suspended,served_match_ids,is_active,status_reason,source_event_ids,rule_snapshot FROM suspensions WHERE player_id=$1 AND tournament_id=$2 AND projection_key IS NOT NULL ORDER BY projection_key',[playerId,tournamentId])).rows;
  const signature=createHash('sha256').update(JSON.stringify({events:active,snapshot})).digest('hex');
  await c.query('INSERT INTO discipline_projection_history(tournament_id,player_id,source_signature,snapshot) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[tournamentId,playerId,signature,JSON.stringify(snapshot)]);
  await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function reconcileTournamentDiscipline(tournamentId:string){
 const events=(await matchPool().query("SELECT DISTINCT player_id FROM match_events e JOIN matches m ON m.id=e.match_id WHERE m.tournament_id=$1 AND e.player_id IS NOT NULL AND e.event_type IN ('YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD')",[tournamentId])).rows;
 const manual=(await disciplinePool().query('SELECT DISTINCT player_id FROM suspensions WHERE tournament_id=$1 AND matches_suspended IS NOT NULL',[tournamentId])).rows;
 for(const id of new Set([...events,...manual].map(r=>r.player_id)))await reconcilePlayerDiscipline(tournamentId,id);
}

export async function assertDisciplineSynchronized(tournamentId:string,playerId:string,query:Pick<PoolClient,'query'>=matchPool()){
 const relevant=(await query.query("SELECT 1 FROM match_events e JOIN matches m ON m.id=e.match_id WHERE m.tournament_id=$1 AND e.player_id=$2 AND e.event_type IN ('YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD') LIMIT 1",[tournamentId,playerId])).rowCount;
 const manual=(await disciplinePool().query('SELECT 1 FROM suspensions WHERE tournament_id=$1 AND player_id=$2 LIMIT 1',[tournamentId,playerId])).rowCount;
 if(!relevant&&!manual)return;
 const pending=await query.query(`SELECT o.id,o.last_error FROM match_event_discipline_outbox o LEFT JOIN match_events e ON e.id=o.event_id
  WHERE o.processed_at IS NULL AND ((o.payload->>'tournamentId'=$1 AND o.action='RECONCILE_RESULT') OR (e.player_id=$2::uuid AND EXISTS(SELECT 1 FROM matches m WHERE m.id=e.match_id AND m.tournament_id=$1::uuid))) LIMIT 1`,[tournamentId,playerId]);
 if(pending.rowCount)throw new AppError(409,'Kỷ luật đang đồng bộ hoặc thiếu căn cứ điều lệ; chưa thể xác nhận cầu thủ đủ điều kiện.','DISCIPLINE_SYNC_PENDING',{reason:pending.rows[0].last_error??null});
}

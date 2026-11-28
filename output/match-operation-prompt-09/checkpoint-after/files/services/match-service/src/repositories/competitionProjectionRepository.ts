import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../lib/db';
import { AppError } from '../lib/errors';
import { rankHybridGroup, type HybridRankingCriterion } from '../services/hybridQualification';
import { fairPlayPenalty, parseFairPlayWeights } from '../services/competitionPolicies';
import { publishMatchUpdate } from '../realtime/matchRealtime';
type Query=Pick<PoolClient,'query'>;
type Row=Record<string,any>;
export async function groupResultSignature(q:Query,tournamentId:string,drawId:string,groupId:string){
 const rows=await q.query(`SELECT m.id,m.status,r.status AS result_status,r.home_score,r.away_score,r.home_extra_time_score,r.away_extra_time_score,
   COALESCE((SELECT jsonb_agg(jsonb_build_array(e.id,e.event_type,e.team_id,e.player_id) ORDER BY e.id) FROM match_events e WHERE e.match_id=m.id AND e.voided_at IS NULL AND e.event_type IN ('YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD')),'[]'::jsonb) AS cards
   FROM matches m LEFT JOIN match_results r ON r.match_id=m.id WHERE m.tournament_id=$1 AND m.draw_version_id=$2 AND m.group_id=$3 AND m.stage='GROUP' ORDER BY m.id`,[tournamentId,drawId,groupId]);
 return createHash('sha256').update(JSON.stringify(rows.rows)).digest('hex');
}
async function basis(tournamentId:string,q:Query){
 const {getPublishedDraw}=await import('../services/fixtureGenerationService');
 const draw=await getPublishedDraw(tournamentId);
 let source:Row|undefined=draw.config?.fixtureRegulationSnapshot;
 const bindings=(await q.query(`SELECT m.id,b.source FROM matches m LEFT JOIN LATERAL
  (SELECT source FROM match_operation_rule_bindings WHERE match_id=m.id ORDER BY revision DESC LIMIT 1) b ON true
  WHERE m.tournament_id=$1 AND m.draw_version_id=$2 AND m.stage='GROUP' ORDER BY m.id`,[tournamentId,draw.id])).rows;
 if(!source?.regulationVersion){const bases=bindings.map(r=>r.source?.base);if(bases.length&&bases.every(b=>b?.regulationVersion&&JSON.stringify(b)===JSON.stringify(bases[0])))source=bases[0];}
 if(!source?.regulationVersion||!source.rules)throw new AppError(409,'Chưa có phiên bản điều lệ chính thức để tính bảng xếp hạng.','STANDINGS_RULES_UNDEFINED');
 const values=bindings.map(r=>r.source?.supplement?.rules?.values??{});
 const choice=(key:string)=>{
  const base=source!.rules.competitionConfig?.[key]??null;
  const declared=values.map(v=>v[key]??base);
  if(!declared.length)return base;
  if(declared.some(v=>v==null)||new Set(declared.map(v=>JSON.stringify(v))).size!==1)return null;
  return declared[0];
 };
 const declaredWeights={YELLOW:choice('fairPlayYellow'),SECOND_YELLOW:choice('fairPlaySecondYellow'),RED:choice('fairPlayRed'),YELLOW_RED:choice('fairPlayYellowRed')};
 return {draw,source,headToHeadPolicy:choice('headToHeadPolicy') as string|null,fairPlay:parseFairPlayWeights(declaredWeights)??parseFairPlayWeights(choice('fairPlayPolicy'))};
}

/** Single read/calculation used by stored standings, public views and qualifiers. */
export async function computeCompetitionStandings(tournamentId:string,q?:Query,providedLots:Row[]=[]):Promise<Awaited<ReturnType<typeof calculateStandings>>>{
 if(q)return calculateStandings(tournamentId,q,providedLots);
 const c=await getPool().connect();
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await calculateStandings(tournamentId,c,providedLots);await c.query('COMMIT');return result;}
 catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
async function calculateStandings(tournamentId:string,q:Query,providedLots:Row[]=[]){
 const b=await basis(tournamentId,q),{draw,source}=b;
 if(source.competitionFormat==='KNOCKOUT')return {drawVersionId:draw.id,competitionFormat:source.competitionFormat,regulationVersion:source.regulationVersion,groups:[],knockoutPairing:null};
 if(source.competitionFormat==='ROUND_ROBIN'&&draw.groups.length!==1)throw new AppError(409,'Vòng tròn chỉ có một bảng theo thể thức đã thống nhất.','ROUND_ROBIN_SINGLE_GROUP_REQUIRED');
 const all=(await q.query(`SELECT m.*,r.status AS result_status,r.home_score,r.away_score,r.home_extra_time_score,r.away_extra_time_score,r.recorded_at,
  g.publication_status FROM matches m JOIN match_fixture_generations g ON g.draw_version_id=m.draw_version_id AND g.stage=m.stage
  LEFT JOIN match_results r ON r.match_id=m.id WHERE m.tournament_id=$1 AND m.draw_version_id=$2 AND m.stage='GROUP' ORDER BY m.id`,[tournamentId,draw.id])).rows;
 const audits=(await q.query('SELECT * FROM match_group_lot_draws WHERE tournament_id=$1 AND draw_version_id=$2 ORDER BY drawn_at',[tournamentId,draw.id])).rows;
 const cards=(await q.query(`SELECT e.* FROM match_events e JOIN matches m ON m.id=e.match_id JOIN match_results r ON r.match_id=m.id
  WHERE m.tournament_id=$1 AND m.draw_version_id=$2 AND m.stage='GROUP' AND m.status IN ('VERIFIED','LOCKED') AND r.status='APPROVED'
    AND e.voided_at IS NULL AND e.event_type IN ('YELLOW_CARD','SECOND_YELLOW_CARD','RED_CARD') ORDER BY e.match_id,e.player_id,e.logical_sequence,e.event_sequence`,[tournamentId,draw.id])).rows;
 const criteria=source.rankingCriteria as HybridRankingCriterion[];
 if(!Array.isArray(criteria)||!criteria.length)throw new AppError(409,'Điều lệ chưa có thứ tự tiêu chí xếp hạng.','STANDINGS_RULES_UNDEFINED');
 const groups=[];
 for(const group of draw.groups){
  const rows=all.filter(r=>r.group_id===group.id),signature=await groupResultSignature(q,tournamentId,draw.id,group.id);
  const fixtures=rows.map(r=>({homeTeamId:r.home_team_id,awayTeamId:r.away_team_id,homeScore:(r.home_score??0)+(r.home_extra_time_score??0),awayScore:(r.away_score??0)+(r.away_extra_time_score??0),status:r.publication_status==='PUBLISHED'?r.status:'UNSCHEDULED',resultStatus:r.result_status??'PENDING'}));
  let fairPlayPoints:Record<string,number>|undefined;
  if(b.fairPlay){
   fairPlayPoints=Object.fromEntries(group.assignments.map(a=>[a.teamId,0]));
   const grouped=new Map<string,Row[]>();for(const e of cards.filter(e=>rows.some(r=>r.id===e.match_id))){const key=e.match_id+':'+e.player_id;grouped.set(key,[...(grouped.get(key)??[]),e]);}
   for(const events of grouped.values())fairPlayPoints[events[0].team_id]=(fairPlayPoints[events[0].team_id]??0)+fairPlayPenalty(events as Array<{event_type:string}>,b.fairPlay);
  }
  const saved=audits.filter(a=>a.group_id===group.id&&a.result_signature===signature).map(a=>({tiedTeamIds:a.tied_team_ids,drawnOrder:a.drawn_order,witnessName:a.witness_name,reason:a.reason}));
  const lots=providedLots.filter(a=>a.groupId===group.id);
  const standings=rankHybridGroup({groupId:group.id,teamIds:group.assignments.map(a=>a.teamId),fixtures,advancingTeamsPerGroup:1,rankingCriteria:criteria,
   pointsForWin:source.rules.pointsForWin,pointsForDraw:source.rules.pointsForDraw,pointsForLoss:source.rules.pointsForLoss,
   headToHeadPolicy:b.headToHeadPolicy,fairPlayPoints,lotDrawResolutions:lots.length?lots as any:saved,preview:true});
  const expected=group.assignments.length*(group.assignments.length-1)/2*source.rules.roundRobinLegs;
  const complete=rows.length===expected&&rows.length>0&&fixtures.every(f=>['VERIFIED','LOCKED'].includes(f.status)&&f.resultStatus==='APPROVED');
  groups.push({groupId:group.id,name:group.name,complete,resultSignature:signature,standings,canRecordLot:complete&&criteria.includes('LOT_DRAW')&&standings.some(t=>t.groupRank===0&&!t.rankingIssue),
   championTeamId:complete&&source.competitionFormat==='ROUND_ROBIN'?standings.find(t=>t.groupRank===1)?.teamId??null:null,
   rankingIssues:[...new Set(standings.filter(t=>t.groupRank===0).map(t=>t.rankingIssue??'Thứ hạng còn hòa theo điều lệ; cần quy trình phân hạng có thẩm quyền.'))]});
 }
 return {drawVersionId:draw.id,competitionFormat:source.competitionFormat,regulationVersion:source.regulationVersion,groups,knockoutPairing:source.rules.competitionConfig?.knockoutPairing??'GROUP_RANK',advancingTeamsPerGroup:source.rules.advancingTeamsPerGroup};
}

export async function enqueueResultDiscipline(q:Query,tournamentId:string){
 // Reuse the durable Match -> Discipline outbox; result fingerprints make replay idempotent.
 await q.query(`INSERT INTO match_event_discipline_outbox(event_id,action,payload,deduplication_key)
  SELECT gen_random_uuid(),'RECONCILE_RESULT',jsonb_build_object('matchId',m.id,'tournamentId',m.tournament_id),
   'result:'||m.id::text||':'||md5(jsonb_build_array(m.status,r.status,r.home_score,r.away_score,r.home_extra_time_score,r.away_extra_time_score,r.home_penalty_score,r.away_penalty_score,r.recorded_at)::text)
  FROM matches m JOIN match_results r ON r.match_id=m.id WHERE m.tournament_id=$1
  ON CONFLICT(deduplication_key) DO NOTHING`,[tournamentId]);
}
async function conflict(q:Query,tournamentId:string,matchId:string|null,key:string,kind:string,details:unknown){
 await q.query('INSERT INTO competition_projection_conflicts(tournament_id,match_id,conflict_key,kind,details) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(conflict_key) DO NOTHING',[tournamentId,matchId,key,kind,JSON.stringify(details)]);
}
export async function synchronizeCompetitionStandings(c:PoolClient,tournamentId:string){
 const table=await computeCompetitionStandings(tournamentId,c);
 for(const group of table.groups)for(const t of group.standings)await c.query(`INSERT INTO standings(tournament_id,team_id,group_id,group_rank,ranking_issue,played,won,drawn,lost,goals_for,goals_against,goal_difference,points)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(tournament_id,team_id) DO UPDATE SET group_id=EXCLUDED.group_id,group_rank=EXCLUDED.group_rank,
  ranking_issue=EXCLUDED.ranking_issue,played=EXCLUDED.played,won=EXCLUDED.won,drawn=EXCLUDED.drawn,lost=EXCLUDED.lost,goals_for=EXCLUDED.goals_for,goals_against=EXCLUDED.goals_against,goal_difference=EXCLUDED.goal_difference,points=EXCLUDED.points,updated_at=NOW()`,
  [tournamentId,t.teamId,group.groupId,t.groupRank,t.rankingIssue??null,t.played,t.won,t.drawn,t.lost,t.goalsFor,t.goalsAgainst,t.goalDifference,t.points]);
 await enqueueResultDiscipline(c,tournamentId);
 if(table.competitionFormat!=='GROUP_AND_KNOCKOUT'||!table.groups.length)return table;
 if(!table.groups.every(g=>g.complete&&g.standings.every(t=>t.groupRank>0))){
  const established=(await c.query('SELECT s.match_id FROM match_knockout_qualifications q JOIN match_bracket_qualification_sources source ON source.draw_version_id=q.draw_version_id AND source.group_id=q.group_id AND source.group_rank=q.group_rank JOIN match_bracket_slots s ON s.id=source.slot_id WHERE q.tournament_id=$1 AND q.draw_version_id=$2',[tournamentId,table.drawVersionId])).rows;
  for(const {match_id} of established)await conflict(c,tournamentId,match_id,`unresolved:${match_id}:${table.groups.map(g=>g.resultSignature).join(':')}`,'QUALIFICATION_UNRESOLVED',{message:'Kết quả/thứ hạng thay đổi sau khi đã xác lập đội đi tiếp; cần BTC xử lý.'});
  return table;
 }
 if(table.knockoutPairing==='REDRAW'){
  await conflict(c,tournamentId,null,`redraw:${table.drawVersionId}`,'HYBRID_REDRAW_REQUIRED',{message:'Điều lệ yêu cầu bốc thăm lại; không tự điền nhánh cố định.'});return table;
 }
 const sources=(await c.query(`SELECT s.*,q.id AS source_id,q.side,q.group_id,q.group_rank,g.publication_status,m.status AS match_status
  FROM match_bracket_qualification_sources q JOIN match_bracket_slots s ON s.id=q.slot_id
  LEFT JOIN matches m ON m.id=s.match_id LEFT JOIN match_fixture_generations g ON g.draw_version_id=s.draw_version_id AND g.stage='KNOCKOUT'
  WHERE s.tournament_id=$1 AND s.draw_version_id=$2 ORDER BY s.round_number,s.position,q.side FOR UPDATE OF s`,[tournamentId,table.drawVersionId])).rows;
 for(const source of sources){
  const group=table.groups.find(g=>g.groupId===source.group_id),team=group?.standings.find(t=>t.groupRank===source.group_rank);
  if(!team)continue;
  const side=source.side==='HOME'?'home':'away',current=source[side+'_team_id'];
  if(current===team.teamId)continue;
  if(current){await conflict(c,tournamentId,source.match_id,`${source.source_id}:${team.teamId}:${group!.resultSignature}`,'QUALIFIER_CHANGED',{sourceId:source.source_id,previousTeamId:current,proposedTeamId:team.teamId,message:'Kết quả thay đổi đội đi tiếp đã xác lập. BTC cần xử lý ảnh hưởng nhánh/lịch/phân công.'});continue;}
  await c.query(`UPDATE match_bracket_slots SET ${side}_team_id=$2,${side}_resolved=TRUE,updated_at=NOW() WHERE id=$1`,[source.id,team.teamId]);
  await c.query(`INSERT INTO match_knockout_qualifications(tournament_id,draw_version_id,team_id,group_id,group_rank) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[tournamentId,table.drawVersionId,team.teamId,source.group_id,source.group_rank]);
 }
 await c.query("UPDATE match_bracket_slots SET status='READY' WHERE tournament_id=$1 AND draw_version_id=$2 AND home_resolved AND away_resolved AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL AND status='WAITING'",[tournamentId,table.drawVersionId]);
 const {resolveReadyBracketSlots}=await import('./matchRepository');await resolveReadyBracketSlots(c,tournamentId,table.drawVersionId);
 for(const id of new Set(sources.map(s=>s.match_id).filter(Boolean)))await publishMatchUpdate(c,id,'bracket.qualification.updated');
 return table;
}

/** Reuses the existing witnessed-lot history, including a round-robin final table. */
export async function recordRankingLot(tournamentId:string,actorId:string,input:any){
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!input||!uuid.test(input.groupId??'')||typeof input.resultSignature!=='string'||!/^[a-f0-9]{64}$/.test(input.resultSignature)||!Array.isArray(input.tiedTeamIds)||input.tiedTeamIds.length<2||input.tiedTeamIds.some((id:unknown)=>typeof id!=='string'||!uuid.test(id))||new Set(input.tiedTeamIds).size!==input.tiedTeamIds.length||!Array.isArray(input.drawnOrder)||input.drawnOrder.length!==input.tiedTeamIds.length||input.drawnOrder.some((id:unknown)=>typeof id!=='string'||!uuid.test(id))||new Set(input.drawnOrder).size!==input.tiedTeamIds.length||!input.tiedTeamIds.every((id:string)=>input.drawnOrder.includes(id))||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.trim().length>1000||typeof input.witnessName!=='string'||input.witnessName.trim().length<2||input.witnessName.trim().length>120)throw new AppError(400,'Cần đúng các đội hòa, thứ tự không trùng, người chứng kiến và biên bản hợp lệ.','INVALID_GROUP_LOT_DRAW');
 const c=await getPool().connect();
 try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[tournamentId]);
  const before=await computeCompetitionStandings(tournamentId,c),group=before.groups.find(g=>g.groupId===input.groupId);
  if(!group?.complete||group.resultSignature!==input.resultSignature)throw new AppError(409,'Kết quả bảng chưa đầy đủ hoặc đã thay đổi; hãy tải lại trước khi ghi biên bản.','GROUP_LOT_DRAW_STALE');
  const previous=(await c.query('SELECT drawn_order,witness_name,reason FROM match_group_lot_draws WHERE draw_version_id=$1 AND group_id=$2 AND tie_key=$3 AND result_signature=$4',[before.drawVersionId,input.groupId,[...input.tiedTeamIds].sort().join(':'),group.resultSignature])).rows[0];
  if(previous){if(JSON.stringify(previous.drawn_order)!==JSON.stringify(input.drawnOrder)||previous.witness_name!==input.witnessName.trim()||previous.reason!==input.reason.trim())throw new AppError(409,'Nhóm đội này đã có biên bản phân hạng; không thay thứ tự bằng thao tác lưu lại.','GROUP_LOT_DRAW_ALREADY_RECORDED');await c.query('COMMIT');return before;}
  const {draw}=await basis(tournamentId,c);
  if(!draw.config?.fixtureRegulationSnapshot?.rankingCriteria?.includes('LOT_DRAW'))throw new AppError(409,'Điều lệ không sử dụng bốc thăm phân hạng.','GROUP_LOT_DRAW_NOT_ALLOWED');
  const evaluated=await computeCompetitionStandings(tournamentId,c,[input]);
  const next=evaluated.groups.find(g=>g.groupId===input.groupId)!;
  const matching=group.standings.find(t=>t.teamId===input.tiedTeamIds[0]&&!t.rankingIssue)?.tiedTeamIds?.slice().sort()??[],provided=[...input.tiedTeamIds].sort();
  if(JSON.stringify(matching)!==JSON.stringify(provided)||next.standings.some(t=>provided.includes(t.teamId)&&!t.groupRank))throw new AppError(409,'Biên bản không khớp nhóm đội đang hòa theo điều lệ.','UNMATCHED_GROUP_LOT_DRAW');
  await c.query(`INSERT INTO match_group_lot_draws(tournament_id,draw_version_id,group_id,tie_key,tied_team_ids,drawn_order,witness_name,reason,drawn_by,result_signature)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(draw_version_id,group_id,tie_key,result_signature) DO NOTHING`,[tournamentId,before.drawVersionId,input.groupId,provided.join(':'),provided,input.drawnOrder,input.witnessName.trim(),input.reason.trim(),actorId,group.resultSignature]);
  const result=await synchronizeCompetitionStandings(c,tournamentId);await c.query('COMMIT');return result;
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}

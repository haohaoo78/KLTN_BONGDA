// Initial fixtures/results below exist ONLY in newly restored, allowlisted QA DBs.
// They test projections/propagation, not the earlier registration/draw workflow.
module.exports=async function(q){
 const {assert,randomUUID,check,ok,rejected,login,prepare,mp,Pool,db,qa,btc,ref,outside,aId,time,advance,syncOutbox,officialSnapshot,before,out,runId}=q;
 const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
 assert(/^sfl_prompt09_qa_/.test(qa('match')));
 const tp=new Pool({connectionString:db(qa('tournament'))}),dp=new Pool({connectionString:db(qa('discipline'))});
 const repo=require(path.join(root,'services/match-service/dist/repositories/matchRepository'));
 const matchService=require(path.join(root,'services/match-service/dist/services/matchService'));
 const projection=require(path.join(root,'services/match-service/dist/repositories/competitionProjectionRepository'));
 const discipline=require(path.join(root,'services/match-service/dist/discipline/services/disciplineService'));
 const {teamDetail}=require(path.join(root,'services/match-service/dist/services/refereePortalService'));
 const originalHybrid='9f765a91-b8ab-4716-a083-0cf8a113db1b';
 const source=await prepare(aId,'IFAB_2026_27',11);
 const remaining=(await ok(btc,`/tournaments/${originalHybrid}/fixtures/operation-rules`)).matches?.filter(m=>m.stage==='GROUP'&&m.eligible&&m.bindingRevision===0)??[];
 if(remaining.length)await ok(btc,`/tournaments/${originalHybrid}/fixtures/operation-rules/apply`,'POST',{supplementId:source.context.operationRules.supplement.id,matches:remaining.map(m=>({matchId:m.matchId,expectedBindingRevision:0})),confirmLegacyBaseVersion:true,reason:'Apply the same declared QA ranking/discipline version to the remaining group fixtures.'});
 const authority=source.context.crew.find(c=>c.isMe).refereeId;
 const actor=authority;assert(actor,'Current authenticated, assigned final authority');
 const clock=async(k,action)=>{const v=(await ok(k.official,`/matches/${k.m.id}/referee-context`)).clock;return ok(k.official,`/matches/${k.m.id}/clock-actions`,'POST',{action,expectedVersion:v.version});};
 await check('real API match FINISHED/PENDING does not enter either official standings path',async()=>{
  await ok(btc,`/tournaments/${source.m.tournamentId}`,'PUT',{status:'IN_PROGRESS'});
  await time(Date.parse(source.context.schedule.scheduledDate)+1000);await clock(source,'START_MATCH');await advance(60000);
  const c=(await ok(ref,`/matches/${aId}/referee-context`)).clock;
  await ok(ref,'/match-events','POST',{matchId:aId,teamId:source.m.homeTeamId,playerId:source.entries[0][1].playerId,eventType:'GOAL',operationId:randomUUID(),phase:c.phase,expectedClockVersion:c.version},201);
  const minutes=Number(source.context.operationRules.rules.values.periodMinutes);await advance((minutes-1)*60000);await clock(source,'END_PERIOD');await clock(source,'START_NEXT_PERIOD');await advance(minutes*60000);await clock(source,'END_PERIOD');await clock(source,'END_MATCH');
  const [oldApi,fixtureApi]=await Promise.all([ok(null,`/tournaments/${originalHybrid}/standings`),ok(null,`/tournaments/${originalHybrid}/fixtures/group-standings/public`)]);
  assert(oldApi.standings.every(t=>t.played===0));assert(fixtureApi.groups.flatMap(g=>g.standings).every(t=>t.played===0));
 });
 await check('final-authority approval updates both API standings paths identically without duplicate points',async()=>{
  const body={matchId:aId,action:'SUBMIT',expectedVersion:0,operationId:randomUUID(),notes:'Prompt 9 QA: approved real match result.'};
  await ok(ref,'/match-reports','POST',body,201);await ok(ref,'/match-reports','POST',body,201);
  const [stored,grouped]=await Promise.all([ok(null,`/tournaments/${originalHybrid}/standings`),ok(btc,`/tournaments/${originalHybrid}/fixtures/group-standings`)]);
  for(const row of stored.standings){const same=grouped.groups.flatMap(g=>g.standings).find(t=>t.teamId===row.teamId);for(const k of ['points','played','won','drawn','lost','goalsFor','goalsAgainst','groupRank'])assert.equal(row[k],same[k],k);}
  assert.equal(stored.standings.reduce((sum,t)=>sum+t.played,0),2);
 });
 async function recalc(t){const c=await mp.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[t]);await repo.recalculateStandings(c,t);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 // Synthetic fixtures intentionally have no fabricated published crew. Seed only
 // their correction request through the real domain service; review is API/RBAC.
 const correction=(m,proposal,reason)=>matchService.requestMatchResultCorrection(m.id,proposal,reason,actor);
 await check('only the assigned final authority can request a correction; the actual organizer can review it',async()=>{
  const input={homeScore:2,awayScore:0,reason:'Controlled QA: verify the correction request and rejection authority.'};
  await rejected(btc,`/matches/${aId}/result-correction-requests`,'POST',input,'REFEREE_MATCH_FORBIDDEN',403);
  const request=(await ok(ref,`/matches/${aId}/result-correction-requests`,'POST',input,201)).request;
  await rejected(outside,`/result-correction-requests/${request.id}/review`,'PUT',{decision:'REJECTED',reviewReason:'Outside account cannot review.'},null,403);
  await ok(btc,`/result-correction-requests/${request.id}/review`,'PUT',{decision:'REJECTED',reviewReason:'Keep the real recorded QA match score unchanged.'});
 });
 async function clone(format,legs=1,count){
  const available=(await ok(btc,'/tournaments?limit=100')).items;
  const template=available.find(t=>t.name.startsWith('DEMO ')&&t.competitionFormat===format);assert(template,'Existing real demo format '+format);const sourceId=template.id;
  const model=(await ok(btc,`/tournaments/${sourceId}`)).tournament;
  const period=(await ok(btc,`/tournaments/${sourceId}/registration-periods`)).periods[0];assert(period,'Existing registration period');
  const dto={...model,...model.rules,name:`QA P9 ${format} ${legs} ${runId}`,pointsForWin:5,pointsForDraw:2,pointsForLoss:1,yellowCardsForSuspension:2,suspensionMatches:1,rankingCriteria:['POINTS','GOAL_DIFFERENCE','GOALS_FOR','LOT_DRAW'],roundRobinLegs:legs,
   startDate:model.startDate.slice(0,10),endDate:model.endDate.slice(0,10),registrationStart:period.startDate.slice(0,10),registrationEnd:period.endDate.slice(0,10),
   ...(count?{minTeams:count,maxTeams:count}:{}),competitionConfig:{...model.rules.competitionConfig,...(format==='KNOCKOUT'?{thirdPlaceMatch:true}: {})}};
  const created=(await ok(btc,'/tournaments','POST',dto,201)).tournament,t=created.id;
  const full=(await ok(btc,`/tournaments/${t}`)).tournament;
  const old=(await tp.query("SELECT * FROM tournament_draw_versions WHERE tournament_id=$1 AND status='PUBLISHED' ORDER BY version DESC LIMIT 1",[sourceId])).rows[0];assert(old);
  const draw=randomUUID(),config={...old.config,fixtureRegulationSnapshot:{regulationVersion:full.rules.publishedVersion,competitionFormat:format,rankingCriteria:full.rankingCriteria,rules:full.rules}};
  await tp.query('BEGIN');try{
   // Fixture factory metadata only. No publication/roster workflow is claimed by this setup.
   await tp.query("UPDATE tournaments SET status='PREPARING' WHERE id=$1",[t]);
   await tp.query('INSERT INTO tournament_draw_versions SELECT (jsonb_populate_record(NULL::tournament_draw_versions,to_jsonb(s)||$2::jsonb)).* FROM tournament_draw_versions s WHERE s.id=$1',[old.id,JSON.stringify({id:draw,tournament_id:t,version:1,config})]);
   const groups=(await tp.query('SELECT * FROM tournament_draw_groups WHERE draw_version_id=$1 ORDER BY name',[old.id])).rows;
   for(const g of groups){const id=randomUUID();await tp.query('INSERT INTO tournament_draw_groups(id,draw_version_id,name,max_teams) VALUES($1,$2,$3,$4)',[id,draw,g.name,count??g.max_teams]);const entries=(await tp.query('SELECT * FROM tournament_draw_assignments WHERE group_id=$1 ORDER BY position',[g.id])).rows.slice(0,count??100);
    for(let i=0;i<entries.length;i++)await tp.query('INSERT INTO tournament_draw_assignments(draw_version_id,group_id,team_id,position,seed_group) VALUES($1,$2,$3,$4,NULL)',[draw,id,entries[i].team_id,i+1]);}
   await tp.query('COMMIT');
  }catch(e){await tp.query('ROLLBACK');throw e;}
  await ok(btc,`/tournaments/${t}/fixtures/generate`,'POST',{legs},201);await ok(btc,`/tournaments/${t}/fixtures/publish`,'POST',{});
  return {t,draw,full,rows:(await mp.query('SELECT * FROM matches WHERE tournament_id=$1 ORDER BY round_number,leg,fixture_key',[t])).rows};
 }
 async function bind(k){
  const {selectMatchLaw}=require(path.join(root,'packages/shared/dist')),format=k.full.footballFormat,rules=selectMatchLaw(format===11?'IFAB_2026_27':format===7?'VFF_7_433_2023':'DECLARED_RULES');
  if(format===5)Object.assign(rules,{edition:'QA declared outdoor-five operation rules',source:`https://qa.sanco.invalid/regulations/${k.t}`,sport:'DECLARED'});
  Object.assign(rules.values,{headToHeadPolicy:'POINTS',fairPlayPolicy:JSON.stringify({YELLOW:2,SECOND_YELLOW:7,RED:9,YELLOW_RED:12}),groupDrawPolicy:'ALLOW_DRAW',disciplineScope:'TOURNAMENT',suspensionStarts:'NEXT_TEAM_MATCH',cardResetPolicy:'CARRY_ALL',directRedSuspensionMatches:2,secondYellowSuspensionMatches:1,secondYellowAccumulation:'EXCLUDE_MATCH',shootoutDiscipline:'RED_ONLY',concurrentSanctions:'SEQUENTIAL'});
  const url=`/tournaments/${k.t}/regulation-operation-rules`,v=(await ok(btc,url,'POST',{baseRegulationVersion:k.full.rules.publishedVersion,expectedRevision:0,rules,reason:'Prompt 9: explicit, versioned QA ranking and card policies.'},201)).version;
  await ok(btc,`${url}/${v.revision}/publish`,'POST',{expectedRevision:v.revision});
  await ok(btc,`/tournaments/${k.t}/fixtures/operation-rules/apply`,'POST',{supplementId:v.id,matches:k.rows.map(m=>({matchId:m.id,expectedBindingRevision:0})),reason:'Explicit controlled QA fixture bindings.'});
 }
 async function seedResult(m,index,status='APPROVED',score){
  const homeWin=m.home_team_id.localeCompare(m.away_team_id)<0,home=score?.[0]??(homeWin?1:0),away=score?.[1]??(homeWin?0:1),date=new Date(Date.UTC(2026,11,1+index,1));
  await mp.query("UPDATE matches SET status=$2,match_date=$3 WHERE id=$1",[m.id,status==='APPROVED'?'VERIFIED':'FINISHED',date]);
  await mp.query("INSERT INTO match_clock_states(match_id,phase,elapsed_seconds,total_elapsed_seconds,is_running,actual_started_at,actual_ended_at) VALUES($1,'ENDED',0,0,FALSE,$2,$3) ON CONFLICT(match_id) DO UPDATE SET actual_started_at=EXCLUDED.actual_started_at,actual_ended_at=EXCLUDED.actual_ended_at",[m.id,date,new Date(date.getTime()+6000000)]);
  const updated=await mp.query("UPDATE match_results SET home_score=$2,away_score=$3,status=$4 WHERE match_id=$1 RETURNING id",[m.id,home,away,status]);
  if(!updated.rowCount)await mp.query("INSERT INTO match_results(match_id,home_score,away_score,recorded_by,status) VALUES($1,$2,$3,$4,$5)",[m.id,home,away,authority,status]);
 }
 const rr1=await clone('ROUND_ROBIN',1),rr2=await clone('ROUND_ROBIN',2);await bind(rr1);await bind(rr2);
 await check('valid QA regulation 5/2/1, round-robin one/two legs, zero teams and champion use one calculation',async()=>{
  for(const k of [rr1,rr2]){assert.equal(k.full.rules.pointsForWin,5);const zero=await ok(null,`/tournaments/${k.t}/fixtures/group-standings/public`);assert.equal(zero.groups.length,1);assert(zero.groups[0].standings.every(r=>r.played===0));
   for(let i=0;i<k.rows.length;i++)await seedResult(k.rows[i],i);
   await recalc(k.t);const table=await ok(null,`/tournaments/${k.t}/fixtures/group-standings/public`),stored=await ok(null,`/tournaments/${k.t}/standings`);assert.equal(table.groups[0].complete,true);assert(table.groups[0].championTeamId);assert.equal(table.groups[0].standings[0].points,5*3*(k===rr2?2:1));assert.equal(stored.standings[0].points,table.groups[0].standings[0].points);
   const ids=k.rows.map(m=>m.id).sort();await ok(btc,`/tournaments/${k.t}/fixtures/generate`,'POST',{legs:k===rr2?2:1});assert.deepEqual((await mp.query('SELECT id FROM matches WHERE tournament_id=$1 ORDER BY id',[k.t])).rows.map(r=>r.id),ids);
  }
 });
 await check('witnessed ranking lots persist, retry does not rerank and altered official result invalidates the prior lot',async()=>{
  for(let i=0;i<rr1.rows.length;i++)await seedResult(rr1.rows[i],i,'APPROVED',[0,0]);await recalc(rr1.t);
  const table=await ok(btc,`/tournaments/${rr1.t}/fixtures/group-standings`),group=table.groups[0],ids=group.standings.map(t=>t.teamId);
  assert(group.standings.every(t=>!t.groupRank));const input={groupId:group.groupId,resultSignature:group.resultSignature,tiedTeamIds:ids,drawnOrder:[...ids].reverse(),witnessName:'QA witness',reason:'Controlled witnessed ranking-lot audit for Prompt 9.'};
  const saved=await ok(btc,`/tournaments/${rr1.t}/fixtures/ranking-lots`,'POST',input),retry=await ok(btc,`/tournaments/${rr1.t}/fixtures/ranking-lots`,'POST',input);assert.deepEqual(retry,saved);assert.equal(saved.groups[0].standings[0].teamId,input.drawnOrder[0]);
  await seedResult(rr1.rows[0],0,'APPROVED',[2,0]);await recalc(rr1.t);await rejected(btc,`/tournaments/${rr1.t}/fixtures/ranking-lots`,'POST',input,'GROUP_LOT_DRAW_STALE');
 });
 const hybrid=await clone('GROUP_AND_KNOCKOUT');await bind(hybrid);
 await check('hybrid qualifiers wait for every APPROVED result, then fill fixed A1/B2 sources without duplicate fixtures',async()=>{
  const groupMatches=hybrid.rows.filter(m=>m.stage==='GROUP'),beforeIds=hybrid.rows.map(m=>m.id).sort();
  for(let i=0;i<groupMatches.length;i++)await seedResult(groupMatches[i],i,i===groupMatches.length-1?'PENDING':'APPROVED');await recalc(hybrid.t);
  assert.equal((await mp.query('SELECT COUNT(*)::int AS n FROM match_knockout_qualifications WHERE tournament_id=$1',[hybrid.t])).rows[0].n,0);
  await seedResult(groupMatches.at(-1),groupMatches.length-1);await recalc(hybrid.t);await recalc(hybrid.t);
  assert.equal((await mp.query('SELECT COUNT(*)::int AS n FROM match_knockout_qualifications WHERE tournament_id=$1',[hybrid.t])).rows[0].n,8);
  const sources=(await mp.query('SELECT q.*,s.home_team_id,s.away_team_id FROM match_bracket_qualification_sources q JOIN match_bracket_slots s ON s.id=q.slot_id WHERE s.tournament_id=$1',[hybrid.t])).rows;
  const table=await ok(null,`/tournaments/${hybrid.t}/fixtures/group-standings/public`);
  for(const s of sources)assert.equal(s.side==='HOME'?s.home_team_id:s.away_team_id,table.groups.find(g=>g.groupId===s.group_id).standings.find(t=>t.groupRank===s.group_rank).teamId);
  assert.deepEqual((await mp.query('SELECT id FROM matches WHERE tournament_id=$1 ORDER BY id',[hybrid.t])).rows.map(r=>r.id),beforeIds);
 });
 await check('a correction changing an established hybrid qualifier stays pending without altering official results or published teams',async()=>{
  const m=hybrid.rows.find(m=>m.stage==='GROUP'),old=(await mp.query('SELECT home_score,away_score FROM match_results WHERE match_id=$1',[m.id])).rows[0],proposal=old.home_score>old.away_score?{homeScore:0,awayScore:9}:{homeScore:9,awayScore:0};
  const prior=(await mp.query('SELECT id,home_team_id,away_team_id FROM match_bracket_slots WHERE tournament_id=$1 ORDER BY id',[hybrid.t])).rows;
  const request=await correction(m,proposal,'Controlled QA: correction affects the fixed group-rank qualification source.');
  await rejected(btc,`/result-correction-requests/${request.id}/review`,'PUT',{decision:'APPROVED',reviewReason:'Check published qualifier impact.'},'CORRECTION_QUALIFIERS_REQUIRE_REVIEW');
  assert.deepEqual((await mp.query('SELECT home_score,away_score FROM match_results WHERE match_id=$1',[m.id])).rows[0],old);
  assert.deepEqual((await mp.query('SELECT id,home_team_id,away_team_id FROM match_bracket_slots WHERE tournament_id=$1 ORDER BY id',[hybrid.t])).rows,prior);
  assert.equal((await mp.query('SELECT status FROM match_result_correction_requests WHERE id=$1',[request.id])).rows[0].status,'PENDING');
 });
 await check('round-robin correction recalculates custom points once and repeat review cannot add points twice',async()=>{
  const m=rr2.rows[0],old=(await ok(null,`/tournaments/${rr2.t}/standings`)).standings.reduce((s,r)=>s+r.points,0),request=await correction(m,{homeScore:1,awayScore:1},'Controlled QA: correct an official round-robin score to a draw.');
  await ok(btc,`/result-correction-requests/${request.id}/review`,'PUT',{decision:'APPROVED',reviewReason:'Approved QA result correction.'});
  const table=(await ok(null,`/tournaments/${rr2.t}/standings`)).standings;assert.equal(table.reduce((s,r)=>s+r.points,0),old-2);
  await rejected(btc,`/result-correction-requests/${request.id}/review`,'PUT',{decision:'APPROVED',reviewReason:'Approved QA result correction.'},'CORRECTION_ALREADY_DECIDED');
  assert.deepEqual((await ok(null,`/tournaments/${rr2.t}/standings`)).standings,table);
 });
 const knockout=await clone('KNOCKOUT',1,7);await bind(knockout);
 await check('knockout BYEs have no fake results; approved winners/losers advance to final/third place with stable IDs',async()=>{
  const initial=(await mp.query('SELECT * FROM match_bracket_slots WHERE tournament_id=$1',[knockout.t])).rows;assert(initial.some(s=>s.status==='COMPLETED'&&!s.match_id));
  let i=0;while(true){const ready=(await mp.query("SELECT m.* FROM matches m JOIN match_bracket_slots s ON s.match_id=m.id WHERE m.tournament_id=$1 AND m.status='UNSCHEDULED' AND m.home_team_id IS NOT NULL AND m.away_team_id IS NOT NULL ORDER BY s.round_number,s.position",[knockout.t])).rows;if(!ready.length)break;
   for(const m of ready){await seedResult(m,i++);const c=await mp.connect();try{await c.query('BEGIN');const winner=m.home_team_id.localeCompare(m.away_team_id)<0?m.home_team_id:m.away_team_id;await repo.advanceApprovedKnockoutWinner(c,m.id,winner);await repo.recalculateStandings(c,knockout.t);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  }
  const slots=(await mp.query('SELECT * FROM match_bracket_slots WHERE tournament_id=$1',[knockout.t])).rows,third=slots.find(s=>s.slot_type==='THIRD_PLACE');assert(third.home_team_id&&third.away_team_id&&third.winner_team_id);
  for(const [side,key]of [['home','home_source_slot_id'],['away','away_source_slot_id']]){const semi=slots.find(s=>s.id===third[key]);assert([semi.home_team_id,semi.away_team_id].includes(third[side+'_team_id']));assert.notEqual(third[side+'_team_id'],semi.winner_team_id);}
  assert.equal((await mp.query('SELECT COUNT(*)::int AS n FROM match_results r JOIN matches m ON m.id=r.match_id WHERE m.tournament_id=$1',[knockout.t])).rows[0].n,knockout.rows.length);
 });
 await check('changing a semifinal winner cannot replace teams in an already published dependent final or third place',async()=>{
  const m=(await mp.query('SELECT m.*,r.home_score,r.away_score FROM matches m JOIN match_bracket_slots s ON s.match_id=m.id JOIN match_results r ON r.match_id=m.id WHERE m.tournament_id=$1 AND s.round_number=2 ORDER BY s.position LIMIT 1',[knockout.t])).rows[0];assert(m);
  const request=await correction(m,{homeScore:m.home_score?0:2,awayScore:m.away_score?0:2},'Controlled QA: a changed semifinal winner affects two published matches.');
  await rejected(btc,`/result-correction-requests/${request.id}/review`,'PUT',{decision:'APPROVED',reviewReason:'Check final and third-place protections.'},'CORRECTION_CASCADE_PUBLISHED');
  assert.equal((await mp.query('SELECT home_score FROM match_results WHERE match_id=$1',[m.id])).rows[0].home_score,m.home_score);
 });
 await check('ranking-lot management is restricted to the actual organizer; private statistics remain private',async()=>{
  await rejected(outside,`/tournaments/${rr1.t}/fixtures/ranking-lots`,'POST',{},null,403);
  const hidden=(await ok(btc,'/tournaments','POST',{...rr1.full,...rr1.full.rules,name:`QA P9 private ${runId}`,startDate:'2027-02-15',endDate:'2027-02-28',registrationStart:'2027-02-01',registrationEnd:'2027-02-10'},201)).tournament;
  await rejected(null,`/tournaments/${hidden.id}/statistics`,'GET',undefined,'TOURNAMENT_NOT_FOUND',404);
 });
 await check('discipline sync pending never reports certain eligibility; threshold, retry, serving and VOID are consistent',async()=>{
  const team=rr2.rows[0].home_team_id,own=rr2.rows.filter(m=>[m.home_team_id,m.away_team_id].includes(team));assert(own.length>=4);
  const actualTeam=await teamDetail(team);
  const player=actualTeam.players?.[0]?.id;assert(player,'Existing actual player of the tested team');
  const ids=[];for(let i=0;i<2;i++){const id=randomUUID(),m=own[i];ids.push(id);await mp.query("INSERT INTO match_events(id,match_id,team_id,player_id,event_type,minute,phase,period_elapsed_seconds,created_by) VALUES($1,$2,$3,$4,'YELLOW_CARD',1,'FIRST_HALF',60,$5)",[id,m.id,team,player,authority]);await mp.query("INSERT INTO match_event_discipline_outbox(event_id,action,payload) VALUES($1,'ISSUE_CARD',$2::jsonb)",[id,JSON.stringify({eventId:id,playerId:player,matchId:m.id,tournamentId:rr2.t,teamId:team,cardType:'YELLOW',issuedBy:authority})]);}
  await assert.rejects(()=>discipline.checkPlayerSuspension(player,rr2.t,own[2].id),e=>e.code==='DISCIPLINE_SYNC_PENDING');
  // Keep future fixtures unapproved while determining the pending match-count ban.
  await mp.query("UPDATE match_results SET status='PENDING' WHERE match_id=ANY($1::uuid[])",[own.slice(2).map(m=>m.id)]);
  for(let i=0;i<15;i++)await syncOutbox();
  const failures=(await mp.query('SELECT action,last_error FROM match_event_discipline_outbox WHERE processed_at IS NULL AND last_error IS NOT NULL')).rows;assert.deepEqual(failures,[]);
  let bans=(await dp.query('SELECT * FROM suspensions WHERE tournament_id=$1 AND player_id=$2 AND projection_key IS NOT NULL',[rr2.t,player])).rows;assert.equal(bans.filter(b=>b.is_active).length,1);assert.equal(bans[0].end_date,null);
  assert.equal(await discipline.checkPlayerSuspension(player,rr2.t,own[2].id),true);
  const beforeCount=(await dp.query('SELECT COUNT(*)::int AS n FROM cards WHERE tournament_id=$1',[rr2.t])).rows[0].n;await syncOutbox();assert.equal((await dp.query('SELECT COUNT(*)::int AS n FROM cards WHERE tournament_id=$1',[rr2.t])).rows[0].n,beforeCount);
  await mp.query("UPDATE match_results SET status='APPROVED' WHERE match_id=$1",[own[2].id]);await recalc(rr2.t);for(let i=0;i<10;i++)await syncOutbox();assert.equal(await discipline.checkPlayerSuspension(player,rr2.t,own[3].id),false);
  bans=(await dp.query('SELECT * FROM suspensions WHERE tournament_id=$1 AND player_id=$2 AND projection_key IS NOT NULL',[rr2.t,player])).rows;assert.equal(bans[0].is_active,false);assert.deepEqual(bans[0].served_match_ids,[own[2].id]);
  await mp.query('UPDATE match_events SET voided_at=NOW(),voided_by=$2,void_reason=$3 WHERE id=$1',[ids[0],authority,'Controlled QA source void.']);await mp.query("INSERT INTO match_event_discipline_outbox(event_id,action,payload) VALUES($1,'VOID_CARD',$2::jsonb)",[ids[0],JSON.stringify({eventId:ids[0],actorId:authority,reason:'Controlled QA source void.'})]);await syncOutbox();
  assert.equal((await dp.query('SELECT COUNT(*)::int AS n FROM suspensions WHERE tournament_id=$1 AND player_id=$2 AND is_active',[rr2.t,player])).rows[0].n,0);
 });
 await check('statistics API excludes live scores and separates administrative/own/shootout goals',async()=>{
  const stats=(await ok(null,`/tournaments/${originalHybrid}/statistics`)).statistics;assert.equal(stats.source,'APPROVED_RESULTS');assert.equal(stats.officialMatchCount,1);assert.equal(stats.fieldGoals,1);assert.equal(stats.players.find(p=>p.playerId===source.entries[0][1].playerId).goals,1);assert(stats.players.every(p=>p.assists===null));
 });
 await check('second-yellow and direct-red sources use separate configured bans; Outbox replay keeps card and ban identities',async()=>{
  const team=rr2.rows[0].home_team_id,own=rr2.rows.filter(m=>[m.home_team_id,m.away_team_id].includes(team)),people=(await teamDetail(team)).players;
  const entries=[[people[1].id,'RED_CARD'],[people[2].id,'YELLOW_CARD'],[people[2].id,'SECOND_YELLOW_CARD']],ids=[];
  for(const [player,kind]of entries){const id=randomUUID();ids.push(id);await mp.query("INSERT INTO match_events(id,match_id,team_id,player_id,event_type,minute,phase,period_elapsed_seconds,created_by) VALUES($1,$2,$3,$4,$5,2,'FIRST_HALF',120,$6)",[id,own[1].id,team,player,kind,authority]);await mp.query("INSERT INTO match_event_discipline_outbox(event_id,action,payload) VALUES($1,'ISSUE_CARD',$2::jsonb)",[id,JSON.stringify({eventId:id,playerId:player,matchId:own[1].id,tournamentId:rr2.t,teamId:team,cardType:kind==='RED_CARD'?'RED':'YELLOW',issuedBy:authority})]);}
  for(let i=0;i<10;i++)await syncOutbox();
  const bans=(await dp.query('SELECT id,player_id,matches_suspended,end_date FROM suspensions WHERE tournament_id=$1 AND player_id=ANY($2::uuid[]) ORDER BY player_id',[rr2.t,[people[1].id,people[2].id]])).rows;
  assert.equal(bans.find(b=>b.player_id===people[1].id).matches_suspended,2);assert.equal(bans.find(b=>b.player_id===people[2].id).matches_suspended,1);assert(bans.every(b=>b.end_date===null));
  await mp.query('UPDATE match_event_discipline_outbox SET processed_at=NULL,available_at=NOW() WHERE event_id=ANY($1::uuid[])',[ids]);await syncOutbox();assert.deepEqual((await dp.query('SELECT id,player_id,matches_suspended,end_date FROM suspensions WHERE tournament_id=$1 AND player_id=ANY($2::uuid[]) ORDER BY player_id',[rr2.t,[people[1].id,people[2].id]])).rows,bans);
 });
 await check('a real API match-count suspension blocks the actual captain roster and has no invented one-year end date',async()=>{
  const team=source.m.homeTeamId,player=source.entries[0][2].playerId,target=(await mp.query("SELECT * FROM matches WHERE tournament_id=$1 AND stage='GROUP' AND id<>$2 AND (home_team_id=$3 OR away_team_id=$3) AND match_date>$4 ORDER BY match_date LIMIT 1",[originalHybrid,aId,team,source.context.schedule.scheduledDate])).rows[0];assert(target);
  const created=(await ok(btc,'/suspensions','POST',{playerId:player,tournamentId:originalHybrid,teamId:team,type:'DISCIPLINARY',startDate:source.context.schedule.scheduledDate,matchesSuspended:1,matchId:aId,reason:'Controlled QA: authorized one-match ban for roster eligibility validation.'},201)).suspension;assert.equal(created.endDate,null);
  const org=new Pool({connectionString:db(qa('team'))}),users=new Pool({connectionString:db(qa('user'))});let email;
  try{const captain=(await org.query('SELECT captain_id FROM teams WHERE id=$1',[team])).rows[0].captain_id;email=(await users.query('SELECT email FROM users WHERE id=$1',[captain])).rows[0].email;}finally{await org.end();await users.end();}
  const captain=(await login(email)).cookie,url=`/matches/${target.id}/squads/${team}`,w=await ok(captain,url),p=w.roster.players.find(p=>p.id===player);assert.equal(p.eligible,false);assert(p.reasons.some(r=>r.includes('treo giò')));
  await rejected(captain,url,'PUT',{entries:[{playerId:player,jerseyNumber:3,position:'MF',isStarting:true}],expectedRevision:w.squad.revision,submit:false},'SQUAD_INVALID');
  await ok(btc,`/suspensions/${created.id}/lift`,'PUT',{});assert.equal((await ok(captain,url)).roster.players.find(p=>p.id===player).eligible,true);
 });
 await check('official five databases unchanged by all QA business writes',async()=>assert.deepEqual(await officialSnapshot(),before));
 fs.writeFileSync(path.join(out,`fixtures-${runId}.json`),JSON.stringify({originalHybrid,rr1,rr2,hybrid,knockout},null,2),{flag:'wx'});
 await tp.end();await dp.end();
};

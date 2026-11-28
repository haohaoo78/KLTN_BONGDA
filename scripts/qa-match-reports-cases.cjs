// Called only by qa-match-reports.cjs, whose database names are allowlisted QA restores.
// Normal authenticated requests exercise the same controllers/repositories as Docker.
module.exports=async function(q){
 const {assert,randomUUID,check,http,ok,rejected,prepare,mp,btc,ref,outside,aId,time,advance,sse,waitFor,sleep,stopChild,startChild,officialSnapshot,before,out,runId}=q;
 const fs=require('node:fs'),path=require('node:path');
 const context=k=>ok(k.official,`/matches/${k.m.id}/referee-context`);
 const managed=(cookie,k)=>ok(cookie,`/matches/${k.m.id}/report/manage`);
 const reportFrom=async(cookie,k)=>(await managed(cookie,k)).report;
 const reportBody=(k,action,expectedVersion,extra={})=>({matchId:k.m.id,action,expectedVersion,operationId:randomUUID(),attendance:100,weather:'Trời quang',notes:'Biên bản QA từ sự kiện chính thức; không nhập lại tỷ số.',...extra});
 async function clock(k,action){const c=(await context(k)).clock;return ok(k.official,`/matches/${k.m.id}/clock-actions`,'POST',{action,expectedVersion:c.version});}
 async function write(k,side,type,index=1,extra={}){const c=(await context(k)).clock;return ok(k.official,'/match-events','POST',{matchId:k.m.id,teamId:side?k.m.awayTeamId:k.m.homeTeamId,playerId:k.entries[side][index].playerId,eventType:type,operationId:randomUUID(),phase:c.phase,expectedClockVersion:c.version,...extra},201);}
 async function play(k){
  await ok(btc,`/tournaments/${k.m.tournamentId}`,'PUT',{status:'IN_PROGRESS'});
  await time(Date.parse(k.context.schedule.scheduledDate)+1000);await clock(k,'START_MATCH');
  await advance(60000);await write(k,0,'GOAL');await write(k,1,'YELLOW_CARD',2);
  const minutes=Number((await context(k)).operationRules.rules.values.periodMinutes);await advance((minutes-1)*60000);await clock(k,'END_PERIOD');
  await clock(k,'START_NEXT_PERIOD');await advance(60000);
  await write(k,0,'SUBSTITUTION_OUT',2,{relatedPlayerId:k.entries[0].find(p=>!p.isStarting).playerId});
  await write(k,0,'INCIDENT',1,{playerId:undefined,description:'Ghi chú điều kiện sân trong kiểm thử QA, không thay đổi kết quả.'});
  await advance((minutes-1)*60000);await clock(k,'END_PERIOD');await clock(k,'END_MATCH');
  const c=await context(k);assert.equal(c.match.status,'FINISHED');assert.equal(c.result.status,'PENDING');return c;
 }
 async function state(k){return (await mp.query(`SELECT
  (SELECT to_jsonb(r) FROM match_reports r WHERE r.match_id=$1) AS report,
  (SELECT to_jsonb(r) FROM match_results r WHERE r.match_id=$1) AS result,
  (SELECT status FROM matches WHERE id=$1) AS status,
  (SELECT COUNT(*)::int FROM match_report_operations WHERE match_id=$1) AS operations,
  (SELECT COUNT(*)::int FROM match_report_reviews WHERE report_id IN(SELECT id FROM match_reports WHERE match_id=$1)) AS reviews,
  (SELECT COUNT(*)::int FROM match_realtime_events WHERE match_id=$1) AS realtime`,[k.m.id])).rows[0];}
 const a=await prepare(aId,'IFAB_2026_27',11);await play(a);
 const standingsBefore=(await mp.query('SELECT * FROM standings ORDER BY tournament_id,team_id')).rows;
 let draft;
 await check('SAVE_DRAFT persists one report and leaves FINISHED/PENDING result and standings unchanged',async()=>{
  const input=reportBody(a,'SAVE_DRAFT',0);draft=(await ok(ref,'/match-reports','POST',input,201)).report;
  assert.equal(draft.status,'DRAFT');assert.equal(draft.submissionSnapshots.length,0);assert(draft.version>=1);
  assert.equal((await reportFrom(ref,a)).id,draft.id);assert.equal((await context(a)).match.status,'FINISHED');
  assert.deepEqual((await mp.query('SELECT * FROM standings ORDER BY tournament_id,team_id')).rows,standingsBefore);
  const retry=(await ok(ref,'/match-reports','POST',input,201)).report;assert.deepEqual(retry,draft);
 });
 await check('report field limit and optimistic version are enforced consistently',async()=>{
  await rejected(ref,'/match-reports','POST',reportBody(a,'SAVE_DRAFT',draft.version,{weather:'x'.repeat(101)}),'VALIDATION_ERROR',400);
  await rejected(ref,'/match-reports','POST',reportBody(a,'SAVE_DRAFT',draft.version-1),'REPORT_VERSION_CONFLICT');
 });
 const ordinary=reportBody(a,'SUBMIT',draft.version),updates=await sse(undefined,ref,a.m.id);
 await check('failure before official result approval rolls back report version, result, standings, receipts and SSE',async()=>{
  const old=await state(a),oldStandings=(await mp.query('SELECT * FROM standings ORDER BY tournament_id,team_id')).rows;
  await mp.query(`CREATE FUNCTION qa_fail_report_approval() RETURNS trigger AS $$ BEGIN IF NEW.status='APPROVED' THEN RAISE EXCEPTION 'Controlled QA report approval failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
   CREATE TRIGGER qa_fail_report_approval BEFORE UPDATE ON match_results FOR EACH ROW EXECUTE FUNCTION qa_fail_report_approval()`);
  try{const response=await http(ref,'/match-reports','POST',ordinary);assert.equal(response.status,500,JSON.stringify(response));assert.deepEqual(await state(a),old);assert.deepEqual((await mp.query('SELECT * FROM standings ORDER BY tournament_id,team_id')).rows,oldStandings);await sleep(300);assert.equal(updates.events.length,0);}
  finally{await mp.query('DROP TRIGGER qa_fail_report_approval ON match_results; DROP FUNCTION qa_fail_report_approval()');}
 });
 await check('late realtime failure rolls back report approval, result, match, standings, receipts and notification',async()=>{
  const old=await state(a),oldStandings=(await mp.query('SELECT * FROM standings ORDER BY tournament_id,team_id')).rows;
  await mp.query(`CREATE FUNCTION qa_fail_report_realtime() RETURNS trigger AS $$ BEGIN IF NEW.event_type='match.finalized' THEN RAISE EXCEPTION 'Controlled QA late report failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
   CREATE TRIGGER qa_fail_report_realtime BEFORE INSERT ON match_realtime_events FOR EACH ROW EXECUTE FUNCTION qa_fail_report_realtime()`);
  try{const response=await http(ref,'/match-reports','POST',ordinary);assert.equal(response.status,500,JSON.stringify(response));assert.deepEqual(await state(a),old);assert.deepEqual((await mp.query('SELECT * FROM standings ORDER BY tournament_id,team_id')).rows,oldStandings);await sleep(150);assert.equal(updates.events.length,0);}
  finally{await mp.query('DROP TRIGGER qa_fail_report_realtime ON match_realtime_events; DROP FUNCTION qa_fail_report_realtime()');}
 });
 let official;
 await check('one appointed referee prepares and atomically confirms; retry/double-click return one approved version',async()=>{
  const both=await Promise.all([ok(ref,'/match-reports','POST',ordinary,201),ok(ref,'/match-reports','POST',ordinary,201)]);
  official=both[0].report;assert.deepEqual(both[1].report,official);assert.equal(official.status,'APPROVED');assert(official.verifiedBy);assert(official.verifiedAt);
  const s=await state(a);assert.equal(s.status,'VERIFIED');assert.equal(s.result.status,'APPROVED');assert.equal(s.reviews,1);assert.equal(official.submissionSnapshots.length,1);
  assert.notDeepEqual((await mp.query('SELECT * FROM standings ORDER BY tournament_id,team_id')).rows,standingsBefore);
  const replay=(await ok(ref,'/match-reports','POST',ordinary,201)).report;assert.deepEqual(replay,official);
  await rejected(ref,'/match-reports','POST',{...ordinary,notes:'Different payload with the same operation'},'REPORT_OPERATION_REUSED');
 });
 await check('SSE publishes committed approval; no event was emitted for the failed transaction',async()=>{
  await waitFor(()=>updates.events.some(e=>e.matchId===a.m.id));
  for(const update of updates.events.filter(e=>e.matchId===a.m.id)){const s=await state(a);assert.equal(s.status,'VERIFIED');assert.equal(s.result.status,'APPROVED');assert(update.id||update.type);}
  updates.close();await updates.done;
 });
 await check('canonical snapshots include score, periods, players, events, clock and crew/context at submission',async()=>{
  const snap=official.submissionSnapshots[0];assert.equal(snap.result.homeScore,1);assert.equal(snap.result.awayScore,0);
  assert(snap.lineups.length>=22);assert(snap.events.some(e=>e.eventType==='GOAL'));assert(snap.events.some(e=>e.eventType==='SUBSTITUTION_IN'));assert(snap.events.some(e=>e.eventType==='YELLOW_CARD'));
  assert(snap.context,'Frozen tournament, team, venue and crew metadata');assert(snap.periods?.length>=2);assert.equal(snap.clock.phase,'ENDED');assert(snap.report);
  fs.writeFileSync(path.join(out,`approved-report-snapshot-${runId}.json`),JSON.stringify(official,null,2),{flag:'wx'});
 });
 await check('approved report history remains unchanged after current lineup/event data changes in QA',async()=>{
  const snap=JSON.parse(JSON.stringify(official.submissionSnapshots)),player=snap[0].lineups[0];
  assert(/^sfl_prompt08_qa_/.test(q.qa('match')));
  // Fault/immutability probe in a QA restore only. Never a product mutation path.
  await mp.query('UPDATE lineups SET jersey_number=98 WHERE match_id=$1 AND player_id=$2',[a.m.id,player.playerId]);
  await mp.query("UPDATE match_events SET description='QA changed current data after confirmed report' WHERE match_id=$1 AND event_type='INCIDENT'",[a.m.id]);
  assert.deepEqual((await reportFrom(ref,a)).submissionSnapshots,snap);
  await assert.rejects(()=>mp.query("UPDATE match_reports SET submission_snapshots='[]'::jsonb WHERE id=$1",[official.id]),/append-only/);
  await assert.rejects(()=>mp.query('UPDATE match_report_reviews SET review_note=review_note WHERE report_id=$1',[official.id]),/append-only/);
  await rejected(ref,'/match-reports','POST',reportBody(a,'SAVE_DRAFT',official.version),null,409);
 });
 await check('backend restart and reload retain report/version/result/history exactly',async()=>{
  const old=await reportFrom(ref,a);await stopChild();await startChild();assert.deepEqual(await reportFrom(ref,a),old);
 });
 // Select real, published, non-overlapping knockout schedules from the restored data.
 const koId='d9fe5a04-5e71-41ec-b85c-f4567b294c68';
 const rows=(await ok(btc,`/tournaments/${koId}/matches?limit=100`)).items.filter(m=>m.status==='SCHEDULED'&&m.homeTeamId&&m.awayTeamId);
 const assigned=(await ok(btc,`/tournaments/${koId}/referee-team/assignments`)).matches;
 const available=rows.filter(m=>!assigned.find(r=>r.matchId===m.id)?.publication).sort((x,y)=>Date.parse(x.matchDate)-Date.parse(y.matchDate));assert(available.length>=2);
 const k=await prepare(available[0].id,'VFF_7_433_2023',7,'dataset.captain02@football.local','FINALIZE_ONLY');await play(k);
 let prepared;
 await check('MANAGE_REPORT support prepares ordinary pending report without routing it to BTC or approving result',async()=>{
  const input=reportBody(k,'SUBMIT',0);prepared=(await ok(outside,'/match-reports','POST',input,201)).report;
  assert.equal(prepared.status,'PENDING');assert.equal(prepared.requiresOrganizerReview,false);assert.equal(prepared.verifiedBy,null);
  const s=await state(k);assert.equal(s.status,'FINISHED');assert.equal(s.result.status,'PENDING');assert.equal(s.reviews,0);
  const data=await context(k);assert(data.assignment.capabilities.includes('FINALIZE'));
 });
 await check('MANAGE_REPORT without FINALIZE cannot confirm; unrelated BTC cannot act as final authority',async()=>{
  const body={operationId:randomUUID(),expectedVersion:prepared.version};
  await rejected(outside,`/match-reports/${prepared.id}/confirm`,'POST',body,null,403);
  await rejected(btc,`/match-reports/${prepared.id}/confirm`,'POST',{...body,operationId:randomUUID()},null,403);
 });
 await check('final authority can request corrections from the preparer without sending an ordinary report to BTC',async()=>{
  await rejected(btc,`/match-reports/${prepared.id}/review`,'PUT',{status:'APPROVED'},'FINAL_AUTHORITY_REQUIRED');
  const old=prepared.submissionSnapshots[0];
  const revision=(await ok(ref,`/match-reports/${prepared.id}/confirm`,'POST',{operationId:randomUUID(),expectedVersion:prepared.version,decision:'REQUEST_CHANGES',reason:'QA bổ sung ghi chú và nội dung tổ trọng tài.'})).report;
  assert.equal(revision.status,'REVISION_REQUIRED');
  prepared=(await ok(outside,'/match-reports','POST',reportBody(k,'SUBMIT',revision.version,{notes:'Đã bổ sung theo yêu cầu trọng tài xác nhận cuối.'}),201)).report;
  assert.equal(prepared.submissionSnapshots.length,2);assert.deepEqual(prepared.submissionSnapshots[0],old);assert.equal(prepared.requiresOrganizerReview,false);
 });
 await check('final authority confirms support submission once; timeout retry and parallel requests return same approved report',async()=>{
  const body={operationId:randomUUID(),expectedVersion:prepared.version};const both=await Promise.all([ok(ref,`/match-reports/${prepared.id}/confirm`,'POST',body),ok(ref,`/match-reports/${prepared.id}/confirm`,'POST',body)]);
  assert.deepEqual(both[0].report,both[1].report);assert.equal(both[0].report.status,'APPROVED');
  assert.equal((await ok(ref,`/match-reports/${prepared.id}/confirm`,'POST',body)).report.id,prepared.id);
  assert.equal((await state(k)).reviews,2);assert.equal((await state(k)).status,'VERIFIED');
  assert.equal((await mp.query('SELECT winner_team_id FROM match_bracket_slots WHERE match_id=$1',[k.m.id])).rows[0].winner_team_id,k.m.homeTeamId);
 });
 const later=available.find(row=>Date.parse(row.matchDate)>Date.parse(k.context.schedule.scheduledDate)+180*60000);assert(later,'Another non-overlapping real schedule');
 const e=await prepare(later.id,'VFF_7_433_2023',7,'dataset.captain02@football.local','REPORT');await play(e);
 let exceptional;
 await check('explicit exception stays pending for organizer and final authority cannot bypass organizer review',async()=>{
  exceptional=(await ok(ref,'/match-reports','POST',reportBody(e,'SUBMIT',0,{requiresOrganizerReview:true,notes:'QA exception needs organizer decision with preserved report.'}),201)).report;
  assert.equal(exceptional.status,'PENDING');assert.equal(exceptional.requiresOrganizerReview,true);
  await rejected(ref,`/match-reports/${exceptional.id}/confirm`,'POST',{operationId:randomUUID(),expectedVersion:exceptional.version},'REPORT_ORGANIZER_REVIEW_REQUIRED');
  assert.equal((await state(e)).result.status,'PENDING');assert.equal((await state(e)).status,'FINISHED');
 });
 await check('organizer requests revision and new submission preserves prior snapshot and review history',async()=>{
  const revision=(await ok(btc,`/match-reports/${exceptional.id}/review`,'PUT',{status:'REVISION_REQUIRED',reviewNote:'QA yêu cầu bổ sung biên bản ngoại lệ.',operationId:randomUUID(),expectedVersion:exceptional.version})).report;
  assert.equal(revision.status,'REVISION_REQUIRED');
  const again=(await ok(outside,'/match-reports','POST',reportBody(e,'SUBMIT',revision.version,{requiresOrganizerReview:true,notes:'Đã bổ sung hồ sơ ngoại lệ QA.'}),201)).report;
  assert.equal(again.id,exceptional.id);assert.equal(again.submissionSnapshots.length,2);assert.deepEqual(again.submissionSnapshots[0],exceptional.submissionSnapshots[0]);assert(again.reviewHistory.length>=1);
 });
 await check('official five business databases remain unchanged throughout QA',async()=>assert.deepEqual(await officialSnapshot(),before));
};

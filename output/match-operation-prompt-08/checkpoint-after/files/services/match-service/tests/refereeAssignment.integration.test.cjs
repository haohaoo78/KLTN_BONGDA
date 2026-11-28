const test=require('node:test'),assert=require('node:assert/strict');
const HYBRID='9f765a91-b8ab-4716-a083-0cf8a113db1b';
test('manual crews persist partial/complete drafts using cloned real published schedules and real Auth/Tournament services',{
 skip:process.env.RUN_REFEREE_ASSIGNMENT_DB_INTEGRATION!=='1',timeout:110000,
},async()=>{
 const {getPool,closePool}=require('../dist/scheduling/lib/db');
 const {getPool:matchPool,closePool:closeMatchPool}=require('../dist/lib/db');
 const service=require('../dist/scheduling/services/refereeAssignmentService');
 const configRepo=require('../dist/scheduling/repositories/refereeConfigurationRepository');
 const {assertCanManageMatch}=require('../dist/scheduling/authorization');
 const pool=getPool();for(const db of [pool,matchPool()])assert.match((await db.query('SELECT current_database() AS name')).rows[0].name,/^sfl_step6_assignment_qa_/,'Never write to an official database');
 const actor={userId:process.env.QA_BTC_USER_ID,userRoles:['BTC']};assert.match(actor.userId,/^[0-9a-f-]{36}$/);
 const beforeSchedules=(await pool.query('SELECT * FROM schedules ORDER BY id')).rows;
 const beforeConfig=await configRepo.findRefereeConfiguration(HYBRID);assert.ok(beforeConfig);
 assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM schedule_referee_drafts')).rows[0].n,0,'QA drafts must start empty');
 let detail,selectedId,userId;
 const model=n=>[{code:'REFEREE',label:'Trọng tài chính',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE']},...Array.from({length:n-1},(_,i)=>({code:`ASSISTANT_REFEREE_${i+1}`,label:`Trợ lý ${i+1}`,required:true,capabilities:['RECORD_EVENT']}))];
 const payload=(current,slots,positions)=>({slots,expectedRevision:current.revision,configurationRevision:current.configurationRevision,scheduleSignature:current.scheduleSignature,...(positions?{matchPositions:positions}:{})});
 try{
  const workspace=await service.getRefereeAssignmentWorkspace(actor,HYBRID);
  assert.equal(workspace.matches.length,31);assert.ok(workspace.matches.every(row=>row.schedule.status==='PUBLISHED'));
  for(const row of workspace.matches.filter(row=>row.fixture.stage==='GROUP')){
   const proposed=await service.getRefereeAssignmentSuggestions(actor,HYBRID,row.matchId,'',model(1));
   const eligible=proposed.suggestions[0]?.candidates.find(candidate=>candidate.eligible);
   if(eligible){detail=await service.getRefereeAssignmentSuggestions(actor,HYBRID,row.matchId,'');selectedId=row.matchId;userId=eligible.userId;break;}
  }
  assert.ok(detail&&userId,'Requires an existing eligible referee account and existing published match');
  assert.equal(detail.slots.length,0,'Suggestions never auto assign a person');
  detail=await service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,[],model(1)));
  assert.equal(detail.status,'UNASSIGNED');assert.equal(detail.revision,1);assert.equal(detail.complete,false);
  detail=await service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,[{position:'REFEREE',refereeId:userId}]));
  assert.equal(detail.status,'COMPLETE');assert.equal(detail.complete,true);
  for(const n of [2,3,4]){
   detail=await service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,[{position:'REFEREE',refereeId:userId}],model(n)));
   assert.equal(detail.positions.length,n);assert.equal(detail.status,'PARTIAL');assert.equal(detail.missing.length,n-1);
  }
  detail=await service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,[{position:'REFEREE',refereeId:userId}],model(1)));
  const reloaded=await service.getRefereeAssignmentSuggestions(actor,HYBRID,selectedId,'');assert.deepEqual(reloaded.slots,detail.slots);assert.equal(reloaded.revision,detail.revision);
  const stale=payload(detail,detail.slots);stale.expectedRevision--;
  await assert.rejects(service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,stale),{code:'REFEREE_DRAFT_REVISION_CONFLICT'});
  await assert.rejects(service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,{...payload(detail,detail.slots),scheduleSignature:'0'.repeat(64)}),{code:'REFEREE_DRAFT_SCHEDULE_CHANGED'});
  const outcomes=await Promise.allSettled([service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,detail.slots)),service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,detail.slots))]);
  assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal(outcomes.filter(row=>row.status==='rejected'&&row.reason.code==='REFEREE_DRAFT_REVISION_CONFLICT').length,1);
  detail=await service.getRefereeAssignmentSuggestions(actor,HYBRID,selectedId,'');
  await assert.rejects(assertCanManageMatch({userId,userRoles:['REFEREE']},selectedId,'FINALIZE'),{status:403});
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM schedule_referee_assignments WHERE schedule_id=$1 AND is_active=TRUE',[detail.scheduleId])).rows[0].n,0,'Draft never publishes a crew');
  assert.equal((await pool.query('SELECT referee_id FROM schedules WHERE id=$1',[detail.scheduleId])).rows[0].referee_id,null,'Draft does not grant legacy match access');
  const updated=await service.getRefereeAssignmentWorkspace(actor,HYBRID);assert.equal(updated.stats.complete,1);
  const overlap=updated.matches.find(row=>row.matchId!==selectedId&&Date.parse(row.schedule.scheduledDate)<Date.parse(detail.occupancy.occupiedTo)&&Date.parse(row.schedule.scheduledDate)+row.schedule.durationMinutes*60000>Date.parse(detail.occupancy.occupiedFrom));
  assert.ok(overlap,'Cloned official schedules must contain simultaneous existing matches');
  const other=await service.getRefereeAssignmentSuggestions(actor,HYBRID,overlap.matchId,'',model(1));
  assert.ok(other.suggestions[0].candidates.find(candidate=>candidate.userId===userId).issues.some(issue=>issue.code==='DUTY_OVERLAP'));
  const configurationRevision=(await configRepo.findRefereeConfiguration(HYBRID)).revision;
  await assert.rejects(service.saveRefereeAssignmentDraft(actor,HYBRID,overlap.matchId,payload(other,[{position:'REFEREE',refereeId:userId}],model(1))),{code:'REFEREE_DRAFT_CONFLICT'});
  assert.equal((await configRepo.findRefereeConfiguration(HYBRID)).revision,configurationRevision,'Failed assignment rolls back inline configuration override too');
  const inactive=detail.suggestions.flatMap(row=>row.candidates).find(candidate=>candidate.issues.some(issue=>issue.code==='ACCOUNT_INACTIVE'));
  assert.ok(inactive);await assert.rejects(service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,[{position:'REFEREE',refereeId:inactive.userId}])),{code:'REFEREE_DRAFT_CONFLICT'});
  await assert.rejects(service.getRefereeAssignmentWorkspace({userId,userRoles:['REFEREE','TEAM_CAPTAIN']},HYBRID),{status:403});
  // Exercise an already-published fixture state only in this isolated cloned QA database.
  await pool.query('UPDATE schedule_referee_drafts SET published_at=NOW() WHERE schedule_id=$1',[detail.scheduleId]);
  await assert.rejects(service.saveRefereeAssignmentDraft(actor,HYBRID,selectedId,payload(detail,detail.slots)),{code:'REFEREE_DRAFT_PUBLISHED_LOCKED'});
  await pool.query('UPDATE schedule_referee_drafts SET published_at=NULL WHERE schedule_id=$1',[detail.scheduleId]);
  assert.deepEqual((await pool.query('SELECT * FROM schedules ORDER BY id')).rows,beforeSchedules,'No existing schedule, time, venue, status or lock may be changed');
 }finally{
  // Only draft rows created by this test in a guarded QA copy are removed.
  await pool.query('DELETE FROM schedule_referee_drafts WHERE tournament_id=$1',[HYBRID]);
  await pool.query('UPDATE tournament_referee_configurations SET configuration=$2::jsonb,revision=$3,updated_at=$4,updated_by=$5 WHERE tournament_id=$1',[HYBRID,JSON.stringify(beforeConfig.configuration),beforeConfig.revision,beforeConfig.updatedAt,beforeConfig.updatedBy]);
  await closePool();await closeMatchPool();
 }
});

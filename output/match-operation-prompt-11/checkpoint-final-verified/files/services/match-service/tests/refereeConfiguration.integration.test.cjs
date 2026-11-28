const test = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
test('PostgreSQL stores scoped configuration, rejects stale/concurrent writes and protects assigned crew', {skip:process.env.RUN_REFEREE_CONFIG_DB_INTEGRATION!=='1'}, async()=>{
  const {getPool,closePool}=require('../dist/scheduling/lib/db');
  const {getPool:getMatchPool,closePool:closeMatchPool}=require('../dist/lib/db');
  const repo=require('../dist/scheduling/repositories/refereeConfigurationRepository');
  const schedules=require('../dist/scheduling/repositories/schedulingRepository');
  const authorization=require('../dist/scheduling/authorization');
  const pool=getPool(),matchPool=getMatchPool();
  for (const database of [pool,matchPool]) assert.match((await database.query('SELECT current_database() AS name')).rows[0].name,/step6.*qa/i,'Isolated QA database required');
  const tournamentId=randomUUID(),actorId=randomUUID(),matchIds=[randomUUID(),randomUUID()],venueId=randomUUID(),scheduleId=randomUUID(),userId=randomUUID();
  const main={code:'REFEREE',label:'Trọng tài chính',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE']};
  let config={defaultPositions:[main],overrides:[]};
  try {
    for(let i=0;i<matchIds.length;i++) await matchPool.query(`INSERT INTO matches(id,tournament_id,home_team_id,away_team_id,stage,round_number,round,status) VALUES($1,$2,$3,$4,'GROUP',$5,$6,'SCHEDULED')`,[matchIds[i],tournamentId,randomUUID(),randomUUID(),i+1,`Vòng ${i+1}`]);
    const saved=await repo.saveRefereeConfiguration(tournamentId,config,0,actorId,async()=>{});
    assert.equal(saved.revision,1);
    assert.deepEqual((await repo.findRefereeConfiguration(tournamentId)).configuration,config);
    await assert.rejects(repo.saveRefereeConfiguration(tournamentId,config,0,actorId,async()=>{}),{code:'REFEREE_CONFIG_REVISION_CONFLICT'});
    const attempts=await Promise.allSettled([repo.saveRefereeConfiguration(tournamentId,config,1,actorId,async()=>{}),repo.saveRefereeConfiguration(tournamentId,config,1,actorId,async()=>{})]);
    assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(attempts.filter(r=>r.status==='rejected'&&r.reason.code==='REFEREE_CONFIG_REVISION_CONFLICT').length,1);
    config={...config,overrides:[{id:randomUUID(),scope:'ROUND',stage:'GROUP',roundNumber:2,positions:[main,{code:'SECRETARY',label:'Thư ký',required:false,capabilities:['MANAGE_REPORT']}]}]};
    await repo.saveRefereeConfiguration(tournamentId,config,2,actorId,async()=>{});
    assert.equal((await repo.configuredPositionsForMatch(tournamentId,matchIds[0])).length,1);
    assert.equal((await repo.configuredPositionsForMatch(tournamentId,matchIds[1])).length,2);
    await pool.query(`INSERT INTO venues(id,name,location) VALUES($1,'Isolated config QA','QA')`,[venueId]);
    await pool.query(`INSERT INTO schedules(id,tournament_id,match_id,venue_id,scheduled_date,status,created_by) VALUES($1,$2,$3,$4,'2027-01-01T08:00:00Z','PUBLISHED',$5)`,[scheduleId,tournamentId,matchIds[1],venueId,actorId]);
    const crew=[{refereeId:userId,position:'REFEREE',isFinalAuthority:true}];
    await schedules.replaceScheduleRefereeAssignments(scheduleId,crew,actorId);
    const assigned=await schedules.listScheduleRefereeAssignments(scheduleId);
    // This invokes the real service guard with actual persisted crew/config, without changing match results.
    const actor={userId,userRoles:['REFEREE']};
    await authorization.assertCanManageMatch(actor,matchIds[1],'FINALIZE');
    await authorization.assertCanManageMatch(actor,matchIds[1],'MANAGE_REPORT');
    const permissions={...config,overrides:[{...config.overrides[0],positions:[{...main,capabilities:['FINALIZE']},config.overrides[0].positions[1]]}]};
    await assert.rejects(repo.saveRefereeConfiguration(tournamentId,permissions,3,actorId,async()=>{}),{code:'REFEREE_CONFIG_ASSIGNMENTS_AFFECTED'});
    const required={...config,overrides:[{...config.overrides[0],positions:[main,{...config.overrides[0].positions[1],required:true}]}]};
    await assert.rejects(repo.saveRefereeConfiguration(tournamentId,required,3,actorId,async()=>{}),{code:'REFEREE_CONFIG_ASSIGNMENTS_AFFECTED'});
    assert.deepEqual(await schedules.listScheduleRefereeAssignments(scheduleId),assigned,'Rejected configuration leaves assignment rows unchanged');
    assert.equal((await repo.findRefereeConfiguration(tournamentId)).revision,3);
    const secretaryId=randomUUID();
    await schedules.replaceScheduleRefereeAssignments(scheduleId,[...crew,{refereeId:secretaryId,position:'SECRETARY',isFinalAuthority:false}],actorId);
    const secretary={userId:secretaryId,userRoles:['REFEREE']};
    await authorization.assertCanManageMatch(secretary,matchIds[1],'MANAGE_REPORT');
    await assert.rejects(authorization.assertCanManageMatch(secretary,matchIds[1],'RECORD_EVENT'),{status:403});
    await assert.rejects(authorization.assertCanManageMatch(secretary,matchIds[1],'FINALIZE'),{status:403});
    await assert.rejects(authorization.assertCanManageMatch({userId:randomUUID(),userRoles:['REFEREE']},matchIds[1],'READ'),{status:403});
    await assert.rejects(schedules.replaceScheduleRefereeAssignments(scheduleId,[{refereeId:userId,position:'SECRETARY',isFinalAuthority:true}],actorId),{code:'REFEREE_CONFIG_ASSIGNMENT_CONFLICT'});
    const client=await pool.connect();
    try {
      await client.query('BEGIN');await repo.lockRefereeConfiguration(client,tournamentId);
      let completed=false;
      const pending=repo.saveRefereeConfiguration(tournamentId,config,3,actorId,async()=>{}).then(()=>{completed=true;});
      await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal(completed,false,'Configuration changes wait for assignment lock');
      await client.query('COMMIT');await pending;
    } finally {client.release();}
    assert.equal((await repo.findRefereeConfiguration(tournamentId)).revision,4);
  } finally {
    // Dedicated QA rows only. Never runs against an official database.
    await pool.query('DELETE FROM schedules WHERE id=$1',[scheduleId]);
    await pool.query('DELETE FROM venues WHERE id=$1',[venueId]);
    await pool.query('DELETE FROM tournament_referee_configurations WHERE tournament_id=$1',[tournamentId]);
    await matchPool.query('DELETE FROM matches WHERE id=ANY($1::uuid[])',[matchIds]);
    await closePool();await closeMatchPool();
  }
});

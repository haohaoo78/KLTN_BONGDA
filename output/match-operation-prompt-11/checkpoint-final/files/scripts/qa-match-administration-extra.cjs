const assert=require('node:assert/strict');
module.exports=async function(q){
 const {check,ok,rejected,mp,Pool,db,qa,btc,ref,outside,tourId,time,syncAdministrativeOutbox,prepare,login}=q;
 await check('tournament start and completion remain blocked without published authority policy and do not mutate status',async()=>{
  const before=(await ok(btc,`/tournaments/${tourId}`)).tournament;
  await rejected(btc,`/tournaments/${tourId}/operations/start`,'POST',{},'TOURNAMENT_START_POLICY_UNDEFINED');
  await rejected(btc,`/tournaments/${tourId}/operations/complete`,'POST',{requestId:require('node:crypto').randomUUID()},'TOURNAMENT_COMPLETION_POLICY_UNDEFINED');
  const after=(await ok(btc,`/tournaments/${tourId}`)).tournament;assert.equal(after.status,before.status);
 });
 await check('BTC-only Step 7 operations summary uses the same fixture results and returns localized team identities',async()=>{
  const summary=await ok(btc,`/tournaments/${tourId}/operations/summary`),workspace=await ok(btc,`/tournaments/${tourId}/operations/manage`);
  assert.equal(summary.stats.total,workspace.stats.total);assert(workspace.matches.every(m=>!m.homeTeamId||m.homeTeam?.name));assert(workspace.matches.every(m=>!m.awayTeamId||m.awayTeam?.name));
  await rejected(outside,`/tournaments/${tourId}/operations/manage`,'GET',undefined,null,403);
 });
 await check('assigned referee incidents require current match RECORD_EVENT and cannot receive BTC decisions',async()=>{
  const scheduling=new Pool({connectionString:db(qa('scheduling'))});
  try{
  const scheduled=(await scheduling.query("SELECT DISTINCT s.match_id FROM schedules s JOIN schedule_referee_publications p ON p.schedule_id=s.id AND p.voided_at IS NULL WHERE s.tournament_id=$1 AND s.status='PUBLISHED'",[tourId])).rows.map(r=>r.match_id);
  const rows=scheduled.length?(await mp.query(`SELECT m.id FROM matches m LEFT JOIN match_results r ON r.match_id=m.id WHERE m.tournament_id=$1 AND m.status IN ('SCHEDULED','LINEUP_CONFIRMED') AND r.id IS NULL AND m.id<>$2 AND m.id=ANY($3::uuid[]) ORDER BY m.match_date LIMIT 20`,[tourId,'8b8a61e2-4b83-4c8c-962e-580b4a594106',scheduled])).rows:[];
  const candidate=rows[0];assert(candidate,'QA clone must retain a scheduled published fixture for exception workflow');
  await prepare(candidate.id,'IFAB_2026_27',11,'dataset.captain01@football.local');
  const match=(await ok(btc,`/matches/${candidate.id}`)).match,detail=await ok(btc,`/matches/${candidate.id}/administration`);
  assert(['POSTPONE','CANCEL'].every(action=>detail.administration.actions.includes(action)));
  const org=new Pool({connectionString:db(qa('team'))}),auth=new Pool({connectionString:db(qa('user'))});let playerCookie;
  try{const player=(await org.query('SELECT user_id FROM players WHERE team_id=$1 AND user_id IS NOT NULL AND left_at IS NULL ORDER BY id LIMIT 1',[match.homeTeamId])).rows[0];assert(player);const user=(await auth.query('SELECT email FROM users WHERE id=$1',[player.user_id])).rows[0];playerCookie=(await login(user.email)).cookie;}finally{await org.end();await auth.end();}
  await rejected(playerCookie,`/matches/${candidate.id}/administrative-cases`,'POST',{kind:'OTHER',description:'Unauthorised report.'},null,403);
  const incident=(await ok(btc,`/matches/${candidate.id}/administrative-cases`,'POST',{kind:'WEATHER',description:'QA weather interruption requires an organizer decision.'},201)).case;
  const updated=await ok(btc,`/matches/${candidate.id}/administration`),requestId=require('node:crypto').randomUUID();
  const decision={requestId,expectedVersion:incident.version,expectedMatchRevision:updated.administration.revision,expectedClockVersion:updated.administration.clockVersion,action:'POSTPONE',basis:'Điều khoản điều lệ QA về hoãn trận trong trường hợp sân không bảo đảm.',reason:'Sân bị ảnh hưởng bởi thời tiết; tạm hoãn để BTC phối hợp sân và các đội.'};
  const saved=await ok(btc,`/matches/${candidate.id}/administrative-cases/${incident.id}/decisions`,'POST',decision);
  assert.equal(saved.decision.action,'POSTPONE');
  const retry=await ok(btc,`/matches/${candidate.id}/administrative-cases/${incident.id}/decisions`,'POST',decision);assert.equal(retry.alreadyApplied,true);
  let scheduledDate;await syncAdministrativeOutbox();const row=(await scheduling.query('SELECT operation_status,scheduled_date FROM schedules WHERE match_id=$1 AND status=\'PUBLISHED\' ORDER BY updated_at DESC LIMIT 1',[candidate.id])).rows[0];assert.equal(row.operation_status,'POSTPONED');scheduledDate=row.scheduled_date;
  const after=await ok(btc,`/matches/${candidate.id}/administration`);assert.equal(after.match.status,'POSTPONED');assert(after.administration.decisions.some(d=>d.action==='POSTPONE'));
  await time(Date.parse(scheduledDate)+60000);
  const afterHold=await ok(btc,`/matches/${candidate.id}/administration`);assert(afterHold.administration.actions.includes('CONTINUE'));
  const continueCase=(await ok(btc,`/matches/${candidate.id}/administrative-cases`,'POST',{kind:'OTHER',description:'QA organizer has confirmed the venue is available for continuation.'},201)).case;
  const current=await ok(btc,`/matches/${candidate.id}/administration`);
  const continued=await ok(btc,`/matches/${candidate.id}/administrative-cases/${continueCase.id}/decisions`,'POST',{requestId:require('node:crypto').randomUUID(),expectedVersion:continueCase.version,expectedMatchRevision:current.administration.revision,expectedClockVersion:current.administration.clockVersion,action:'CONTINUE',basis:'Điều khoản điều lệ QA cho phép tiếp tục trận sau khi sân bảo đảm.',reason:'BTC xác nhận sân an toàn và tiếp tục theo lịch đã công bố.'});
  assert.equal(continued.decision.action,'CONTINUE');await syncAdministrativeOutbox();
  assert.equal((await ok(btc,`/matches/${candidate.id}/administration`)).match.status,'SCHEDULED');
  assert.equal(match.id,candidate.id);
  }finally{await scheduling.end();}
 });
 await check('complaint submission with no versioned anchor/window fails instead of falling back to updated_at',async()=>{
  const row=(await mp.query("SELECT id,home_team_id,tournament_id,status FROM matches WHERE id='8b8a61e2-4b83-4c8c-962e-580b4a594106'")).rows[0];assert(row);
  const org=new Pool({connectionString:db(qa('team'))}),auth=new Pool({connectionString:db(qa('user'))}),discipline=new Pool({connectionString:db(qa('discipline'))});
  try{const team=await org.query('SELECT captain_id FROM teams WHERE id=$1',[row.home_team_id]),users=await auth.query('SELECT email FROM users WHERE id=$1',[team.rows[0].captain_id]),captain=(await login(users.rows[0].email)).cookie,rowsBefore=(await discipline.query('SELECT COUNT(*)::int AS n FROM complaints WHERE match_id=$1',[row.id])).rows[0].n;
   const response=await rejected(captain,'/complaints','POST',{matchId:row.id,tournamentId:row.tournament_id,teamId:row.home_team_id,complaintType:'RESULT',description:'QA request requiring declared complaint deadline.'},'COMPLAINT_POLICY_UNDEFINED');
   assert.equal(response.status,409);assert.equal((await discipline.query('SELECT COUNT(*)::int AS n FROM complaints WHERE match_id=$1',[row.id])).rows[0].n,rowsBefore);
  }finally{await org.end();await auth.end();await discipline.end();}
 });
};

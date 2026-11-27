// Prompt 3 controlled QA: normal Auth + Gateway, real service routers and four
// restored PostgreSQL databases. No official match/fixture/schedule mutations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/match-operation-prompt-03');
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const express=require(path.join(root,'services/match-service/node_modules/express'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const runId=process.argv[2]||'001';assert(/^\d{3}$/.test(runId));
const qa=name=>`sfl_prompt03_qa_${name}_20261126_${runId}`;
function db(name,readOnly=false){assert(/^sfl_(prompt03_qa_|auth$|user$|tournament$|match$|scheduling$|discipline$)/.test(name));const u=new URL(`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/${name}`);if(readOnly)u.searchParams.set('options','-c default_transaction_read_only=on');return u.toString();}
const tourId='9f765a91-b8ab-4716-a083-0cf8a113db1b',aId='8b8a61e2-4b83-4c8c-962e-580b4a594106';
const checks=[],servers=[],startedAt=new Date().toISOString();let gateway,timeMock;
const gatewayLog=fs.openSync(path.join(out,`qa-gateway-${runId}.log`),'a');
async function snapshot(name){const p=new Pool({connectionString:db(name,true)}),c=await p.connect(),result={};try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const {tablename:t}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){assert(/^[a-z_0-9]+$/.test(t));result[t]=(await c.query(`SELECT COUNT(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${t}" t`)).rows[0];}
  await c.query('COMMIT');return result;
}finally{c.release();await p.end();}}
async function officialSnapshot(){return Object.fromEntries(await Promise.all(['tournament','match','scheduling','discipline'].map(async name=>[name,await snapshot('sfl_'+name)])));}
async function check(name,task){await task();checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function http(cookie,endpoint,method='GET',body){const r=await fetch('http://127.0.0.1:19080/api'+endpoint,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?null:await r.json()};}
async function ok(cookie,endpoint,method='GET',body,status=200){const r=await http(cookie,endpoint,method,body);assert.equal(r.status,status,endpoint+' '+JSON.stringify(r.body));return r.body;}
async function login(email){const password=fs.readFileSync(path.join(root,'docs/DEMO_ACCOUNTS_AND_TESTING.md'),'utf8').match(/Demo@\d{6}/)?.[0];assert(password);const r=await fetch('http://127.0.0.1:19080/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Normal Auth login');const data=await r.json();return {cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),data};}
async function listen(app,port){servers.push(await new Promise((resolve,reject)=>{const server=app.listen(port,'127.0.0.1',()=>resolve(server));server.on('error',reject);}));}
async function mount(routerPath,errorPath,port,prefix=''){const app=express();app.use(express.json());app.use(prefix,require(path.join(root,routerPath)).internalRoutes??require(path.join(root,routerPath)).tournamentRoutes??require(path.join(root,routerPath)).matchRoutes);app.use(require(path.join(root,errorPath)).errorHandler);await listen(app,port);return app;}
async function main(){
  const before=await officialSnapshot();if(!process.argv.includes('--verify-readiness'))fs.writeFileSync(path.join(out,'database-before.json'),JSON.stringify(before,null,2));
  Object.assign(process.env,env,{NODE_ENV:'test',INTERNAL_API_KEY:env.INTERNAL_API_KEY,AUTH_SERVICE_URL:'http://127.0.0.1:19201',ORGANIZATION_SERVICE_URL:'http://127.0.0.1:3004',TOURNAMENT_SERVICE_URL:'http://127.0.0.1:19203',MATCH_SERVICE_URL:'http://127.0.0.1:19204',NOTIFICATION_SERVICE_URL:'http://127.0.0.1:1',DATABASE_URL:db('sfl_auth',true),ACCOUNT_DATABASE_URL:db('sfl_user',true)});
  await mount('services/auth-service/dist/account/routes/internalRoutes','services/auth-service/dist/middleware/errorHandler',19201,'/internal');
  process.env.DATABASE_URL=db(qa('tournament'));
  await mount('services/tournament-service/dist/routes/tournamentRoutes','services/tournament-service/dist/middleware/errorHandler',19203);
  process.env.DATABASE_URL=db(qa('match'));process.env.SCHEDULING_DATABASE_URL=db(qa('scheduling'));process.env.DISCIPLINE_DATABASE_URL=db(qa('discipline'));
  const app=await mount('services/match-service/dist/routes/matchRoutes','services/match-service/dist/middleware/errorHandler',19204);
  app.use(require(path.join(root,'services/match-service/dist/scheduling/routes/schedulingRoutes')).schedulingRoutes);
  app.use(require(path.join(root,'services/match-service/dist/middleware/errorHandler')).errorHandler);
  gateway=spawn(process.execPath,[path.join(root,'apps/api-gateway/dist/index.js')],{cwd:root,env:{...process.env,PORT:'19080',AUTH_SERVICE_URL:'http://127.0.0.1:3001',CORS_ORIGIN:'http://127.0.0.1:19080'},stdio:['ignore',gatewayLog,gatewayLog],windowsHide:true});
  for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:19080/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const btc=(await login('dataset.btc01@football.local')).cookie,ref=(await login('dataset.captain02@football.local')).cookie,outside=(await login('dataset.captain01@football.local')).cookie;
  const authUser=(await ok(ref,'/auth/me')).user,refMe={...authUser,id:authUser?.userId};assert(refMe.id,'Auth current account identity');
  if(process.argv.includes('--verify-readiness')){
    await check('progress separates preparing matches from in-progress matches and keeps partial publication incomplete',async()=>{
      const r=(await ok(btc,`/tournaments/${tourId}/fixtures/operation-readiness`)).readiness;
      assert(r.matches.some(m=>m.matchStatus==='IN_PROGRESS'),'Use the existing started QA match');
      assert.equal(r.stats.ready,r.matches.filter(m=>m.canPrepare&&m.matchStatus!=='IN_PROGRESS').length);
      assert.equal(r.stats.inProgress,r.matches.filter(m=>m.matchStatus==='IN_PROGRESS').length);
      assert.equal(r.allAssignmentsPublished,false);assert.equal(r.canOpenOperations,true);
    });
    await check('read-only progress verification preserves official business data',async()=>assert.deepEqual(await officialSnapshot(),before));
    fs.writeFileSync(path.join(out,`qa-readiness-${runId}.json`),JSON.stringify({startedAt,checks},null,2));return;
  }
  if(process.argv.includes('--verify-concurrent-publication')){
    const workspaceUrl=`/tournaments/${tourId}/referee-team/assignments`,a=(await ok(btc,workspaceUrl)).matches.find(m=>m.matchId===aId);
    const replacement=(await ok(btc,`/tournaments/${tourId}/referee-team`)).members.find(m=>m.identity.email==='dataset.captain01@football.local');assert(replacement);
    const clock=(await ok(ref,`/matches/${aId}/clock`)).clock;assert.equal(clock.isRunning,true,'Use the existing started QA match, without changing its state to make a test pass');
    timeMock=require('node:test').mock.timers;timeMock.enable({apis:['Date'],now:Date.parse(a.schedule.scheduledDate)+120000});
    const p=require(path.join(root,'services/match-service/dist/lib/db')).getPool(),connect=p.connect.bind(p);
    let reached,release,intercepted=false;const atCommit=new Promise(r=>reached=r),continueCommit=new Promise(r=>release=r);
    p.connect=function(callback){if(typeof callback==='function')return connect(callback);return connect().then(client=>{const query=client.query.bind(client),done=client.release.bind(client);client.query=(...args)=>{if(args[0]==='COMMIT'&&!intercepted){intercepted=true;reached();return continueCommit.then(()=>query(...args));}return query(...args);};client.release=(...args)=>{client.query=query;client.release=done;return done(...args);};return client;});};
    await check('real replacement HTTP request waits for an authorized clock mutation and then rejects the started match',async()=>{
      const action=http(ref,`/matches/${aId}/clock-actions`,'POST',{action:'PAUSE',expectedVersion:clock.version});
      await Promise.race([atCommit,action.then(r=>{if(r.status!==200)throw Error(JSON.stringify(r.body));}),new Promise((_,reject)=>setTimeout(()=>reject(Error('No operation commit barrier')),15000))]);
      let replacementFinished=false;
      const replace=http(btc,`${workspaceUrl}/${aId}/replace`,'POST',{requestId:randomUUID(),expectedPublicationRevision:a.publication.revision,scheduleSignature:a.scheduleSignature,position:'REFEREE',oldRefereeId:refMe.id,newRefereeId:replacement.userId,reason:'QA concurrent replacement request; must wait and then reject the running match'}).then(r=>{replacementFinished=true;return r;});
      const observer=new Pool({connectionString:db(qa('scheduling'))});
      try{
        let blocked=false;
        for(let i=0;i<50;i++){const r=await observer.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM schedules%FOR UPDATE%' LIMIT 1");if(r.rowCount){blocked=true;break;}await new Promise(r=>setTimeout(r,50));}
        assert.equal(blocked,true,'Publication writer must be waiting on the Scheduling parent-row lock');assert.equal(replacementFinished,false);
        release();const written=await action;assert.equal(written.status,200,JSON.stringify(written.body));const rejected=await replace;assert.equal(rejected.status,409);assert.equal(rejected.body.error.code,'REFEREE_PUBLICATION_MATCH_LOCKED');
      }finally{release();p.connect=connect;await observer.end();}
    });
    timeMock.reset();timeMock=null;
    await check('concurrent publication QA does not mutate official databases',async()=>assert.deepEqual(await officialSnapshot(),before));
    fs.writeFileSync(path.join(out,`qa-concurrent-${runId}.json`),JSON.stringify({startedAt,checks},null,2));return;
  }
  const summaryUrl=`/tournaments/${tourId}/fixtures/operation-readiness`;
  await check('anonymous cannot read manager readiness',async()=>assert.equal((await http('',summaryUrl)).status,401));
  let initial;
  await check('partial publication opens preparation without completing all of Step 6',async()=>{initial=(await ok(btc,summaryUrl)).readiness;assert(initial.stats.published>0);assert(initial.stats.published<initial.stats.total);assert.equal(initial.canOpenOperations,true);assert.equal(initial.allAssignmentsPublished,false);});
  await check('PREPARING tournament can open Step 7 with valid scoped publication',async()=>{await ok(btc,`/tournaments/${tourId}/workflow-state`,'PUT',{currentStep:7});});
  await check('unassigned referee cannot operate or read another match context',async()=>{assert.equal((await http(outside,`/matches/${aId}/referee-context`)).status,403);assert.equal((await http(outside,`/matches/${aId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0})).status,403);});
  const workspaceUrl=`/tournaments/${tourId}/referee-team/assignments`;
  let workspace=await ok(btc,workspaceUrl),a=workspace.matches.find(m=>m.matchId===aId);assert(a?.publication);
  const schedules=(await ok(btc,`/tournaments/${tourId}/schedules/manage`)).schedules;
  const aSchedule=schedules.find(s=>s.matchId===aId);assert(aSchedule);
  const unassigned=workspace.matches.find(m=>!m.publication&&m.status==='UNASSIGNED'&&m.fixture.stage==='GROUP'&&Date.parse(m.schedule.scheduledDate)>Date.parse(aSchedule.scheduledDate)+86400000);assert(unassigned,'An unused published QA fixture is required');
  await check('published schedule without crew does not permit a match start',async()=>{const r=await http(ref,`/matches/${unassigned.matchId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0});assert.equal(r.status,403);const s=(await ok(btc,summaryUrl)).readiness.matches.find(m=>m.matchId===unassigned.matchId);assert.equal(s.crewPublished,false);assert.equal(s.canPrepare,false);});
  const team=(await ok(btc,`/tournaments/${tourId}/referee-team`)).members;
  const replacement=team.find(member=>member.userId!==refMe.id&&member.identity.email==='dataset.captain01@football.local');assert(replacement,'Existing controlled replacement referee required');
  // Profile changes stay inside the restored Scheduling QA DB; accounts/roles are not changed.
  for(const member of team.filter(member=>[refMe.id,replacement.userId].includes(member.userId))){
    const profile={...member.profile,positions:[...new Set([...member.profile.positions,'REFEREE','MATCH_SECRETARY'])]};
    await ok(btc,`/tournaments/${tourId}/referee-team/${member.id}`,'PATCH',{profile});
  }
  await check('replacement removes old account rights and does not use legacy referee_id',async()=>{
    await ok(btc,`${workspaceUrl}/${aId}/replace`,'POST',{requestId:randomUUID(),expectedPublicationRevision:a.publication.revision,scheduleSignature:a.scheduleSignature,position:'REFEREE',oldRefereeId:refMe.id,newRefereeId:replacement.userId,reason:'Controlled QA replacement before any lineup or kickoff'});
    assert.equal((await http(ref,`/matches/${aId}/referee-context`)).status,403);
    assert.equal((await http(ref,`/matches/${aId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0})).status,403);
    assert.equal((await ok(outside,'/my/schedules/workspace')).items.some(m=>m.match.id===aId),true);
    const next=(await ok(btc,workspaceUrl)).matches.find(m=>m.matchId===aId);
    await ok(btc,`${workspaceUrl}/${aId}/replace`,'POST',{requestId:randomUUID(),expectedPublicationRevision:next.publication.revision,scheduleSignature:next.scheduleSignature,position:'REFEREE',oldRefereeId:replacement.userId,newRefereeId:refMe.id,reason:'Return QA fixture to its initial appointed account'});
  });
  const row=(await ok(btc,workspaceUrl)).matches.find(m=>m.matchId===unassigned.matchId);
  const positions=[{code:'REFEREE',label:'QA main official',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE']},{code:'MATCH_SECRETARY',label:'QA supporting official',required:true,capabilities:['RECORD_EVENT','MANAGE_REPORT']}];
  await check('two-person draft remains draft and does not open that match',async()=>{
    await ok(btc,`${workspaceUrl}/${row.matchId}`,'PUT',{expectedRevision:row.revision,configurationRevision:row.configurationRevision,scheduleSignature:row.scheduleSignature,matchPositions:positions,slots:[{position:'REFEREE',refereeId:refMe.id},{position:'MATCH_SECRETARY',refereeId:replacement.userId}]});
    const s=(await ok(btc,summaryUrl)).readiness.matches.find(m=>m.matchId===row.matchId);assert.equal(s.crewPublished,false);assert.equal(s.canPrepare,false);assert.equal(s.assignmentStatus,'COMPLETE');
  });
  await check('scope publication honors different crew configurations',async()=>{
    const current=(await ok(btc,workspaceUrl)).matches.find(m=>m.matchId===row.matchId);
    await ok(btc,`${workspaceUrl}/publish`,'POST',{requestId:randomUUID(),matches:[{matchId:current.matchId,expectedRevision:current.revision,configurationRevision:current.configurationRevision,scheduleSignature:current.scheduleSignature}]});
    const ready=(await ok(btc,summaryUrl)).readiness;assert(ready.matches.find(m=>m.matchId===row.matchId).crewPublished);assert.equal(ready.allAssignmentsPublished,false);assert.equal(ready.canOpenOperations,true);
    const own=await ok(outside,`/matches/${row.matchId}/referee-context`);assert(own.assignment.capabilities.includes('MANAGE_REPORT'));assert(!own.assignment.capabilities.includes('FINALIZE'));
    assert.equal((await http(outside,`/matches/${row.matchId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0})).status,403);
  });
  const ruleUrl=`/tournaments/${tourId}/regulation-operation-rules`;
  const rules=require(path.join(root,'packages/shared/dist')).selectMatchLaw('IFAB_2026_27');Object.assign(rules.values,{maxSubstitutes:9,shirtNumbers:'UNIQUE_1_99',halfTimeMinutes:10,groupDrawPolicy:'ALLOW_DRAW',substitutionMode:'LIMITED',maxSubstitutions:5,substitutionOpportunities:3,returnSubstitutes:'NO'});
  const version=(await ok(btc,ruleUrl,'POST',{baseRegulationVersion:1,expectedRevision:0,rules,reason:'Explicit QA match rules; original published regulation stays immutable'},201)).version;
  await ok(btc,`${ruleUrl}/${version.revision}/publish`,'POST',{expectedRevision:version.revision});
  await ok(btc,`/tournaments/${tourId}/fixtures/operation-rules/apply`,'POST',{supplementId:version.id,matches:[{matchId:aId,expectedBindingRevision:0}],reason:'Apply to one unused QA fixture for the F01 regression'});
  await check('ready status cannot be forced with zero lineups',async()=>assert.equal((await http(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'})).status,409));
  const match=(await ok(btc,`/matches/${aId}`)).match;
  for(const teamId of [match.homeTeamId,match.awayTeamId]){
    const response=await fetch(`http://127.0.0.1:3004/public/teams/${teamId}`,{headers:{'x-gateway-internal-key':env.INTERNAL_API_KEY}});assert(response.ok,'Organization team data must be read through trusted service access');const detail=await response.json();assert(detail.players.length>=11);
    const keeper=detail.players.find(player=>player.position==='GK');assert(keeper,'Use the actual registered goalkeeper');
    const players=[keeper,...detail.players.filter(player=>player.id!==keeper.id).slice(0,10)];
    for(const [index,player]of players.entries())await ok(btc,'/lineups','POST',{matchId:aId,teamId,playerId:player.id,position:index===0?'GK':'MF',jerseyNumber:index+1,isStarting:true},201);
    await ok(btc,`/matches/${aId}/lineups/${teamId}/confirm`,'PUT',{},204);
  }
  timeMock=require('node:test').mock.timers;timeMock.enable({apis:['Date'],now:Date.parse(aSchedule.scheduledDate)-60000});
  await check('tournament start uses published scoped crew, not schedules.referee_id',async()=>{await ok(btc,`/tournaments/${tourId}`,'PUT',{status:'IN_PROGRESS'});});
  await ok(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'});
  await check('START_MATCH still rejects an early kickoff with valid lineups and crew',async()=>{const r=await http(ref,`/matches/${aId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0});assert.equal(r.status,409);assert.equal(r.body.error.code,'MATCH_KICKOFF_NOT_REACHED');});
  timeMock.setTime(Date.parse(aSchedule.scheduledDate)+60000);
  const matchPool=require(path.join(root,'services/match-service/dist/lib/db')).getPool();
  const originalConnect=matchPool.connect.bind(matchPool);let reached,release;const atCommit=new Promise(r=>reached=r),continueCommit=new Promise(r=>release=r);let intercepted=false;
  matchPool.connect=function(callback){
    if(typeof callback==='function')return originalConnect(callback);
    return originalConnect().then(client=>{
      const query=client.query.bind(client),releaseClient=client.release.bind(client);
      client.query=(...args)=>{if(args[0]==='COMMIT'&&!intercepted){intercepted=true;reached();return continueCommit.then(()=>query(...args));}return query(...args);};
      client.release=(...args)=>{client.query=query;client.release=releaseClient;return releaseClient(...args);};
      return client;
    });
  };
  let started;
  await check('START_MATCH commits in Match DB while Scheduling publication writers are fenced',async()=>{
    const action=http(ref,`/matches/${aId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0});
    await Promise.race([atCommit,action.then(r=>{if(r.status!==200)throw Error('Start rejected before commit: '+JSON.stringify(r.body));}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Clock did not reach the commit barrier')),15000))]);
    const writerPool=new Pool({connectionString:db(qa('scheduling'))}),writer=await writerPool.connect();let acquired=false;
    try{
      await writer.query('BEGIN');const wait=writer.query('SELECT id FROM schedules WHERE id=$1 FOR UPDATE',[aSchedule.id]).then(()=>{acquired=true;});
      await new Promise(r=>setTimeout(r,150));assert.equal(acquired,false,'Concurrent schedule/crew writer must wait for the Match commit');
      release();started=await action;assert.equal(started.status,200,JSON.stringify(started.body));await wait;assert.equal(acquired,true);matchPool.connect=originalConnect;
      assert.equal((await matchPool.query('SELECT status FROM matches WHERE id=$1',[aId])).rows[0].status,'IN_PROGRESS');
      await writer.query('ROLLBACK');
    }finally{release();writer.release();await writerPool.end();matchPool.connect=originalConnect;}
  });
  await check('reload retains the started clock and old expectedVersion cannot overwrite it',async()=>{
    const clock=(await ok(ref,`/matches/${aId}/clock`)).clock;assert.equal(clock.phase,'FIRST_HALF');assert.equal(clock.version,1);
    const stale=await http(ref,`/matches/${aId}/clock-actions`,'POST',{action:'PAUSE',expectedVersion:0});assert.equal(stale.status,409);assert.equal(stale.body.error.code,'CLOCK_VERSION_CONFLICT');
  });
  await check('replacement after a committed kickoff is blocked',async()=>{
    const current=(await ok(btc,workspaceUrl)).matches.find(m=>m.matchId===aId);
    const r=await http(btc,`${workspaceUrl}/${aId}/replace`,'POST',{requestId:randomUUID(),expectedPublicationRevision:current.publication.revision,scheduleSignature:current.scheduleSignature,position:'REFEREE',oldRefereeId:refMe.id,newRefereeId:replacement.userId,reason:'QA negative case after the match began'});assert.equal(r.status,409);
  });
  timeMock.reset();timeMock=null;
  await check('START_MATCH never queried a copied or fake schedules table in Match DB',async()=>{const p=new Pool({connectionString:db(qa('match'))});try{const r=(await p.query("SELECT to_regclass('public.schedules') AS schedules,to_regclass('public.schedule_referee_assignments') AS assignments")).rows[0];assert.equal(r.schedules,null);assert.equal(r.assignments,null);}finally{await p.end();}});
  const after=await officialSnapshot();fs.writeFileSync(path.join(out,'database-after.json'),JSON.stringify(after,null,2));
  await check('official tournament, match, scheduling and discipline databases remain unchanged',async()=>assert.deepEqual(after,before));
  fs.writeFileSync(path.join(out,`qa-api-${runId}.json`),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),databases:['tournament','match','scheduling','discipline'].map(qa),virtualClock:'Only the QA process Date advanced to the existing scheduled kickoff; clock validation was kept active',checks},null,2));
}
main().catch(error=>{checks.push({name:'QA execution',status:'FAIL',reason:error.message});fs.writeFileSync(path.join(out,`qa-api-${runId}.json`),JSON.stringify({startedAt,checks},null,2));console.error(error.message);process.exitCode=1;}).finally(async()=>{
  timeMock?.reset();gateway?.kill();for(const server of servers)server.closeAllConnections?.();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
  for(const name of ['services/tournament-service/dist/lib/db','services/match-service/dist/lib/db','services/match-service/dist/scheduling/lib/db','services/match-service/dist/discipline/lib/db','services/auth-service/dist/account/lib/db']){const mod=require.cache[require.resolve(path.join(root,name))];if(mod?.exports.closePool)await mod.exports.closePool();}
});

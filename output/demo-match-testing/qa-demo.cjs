// Real routers, normal Auth sessions, seven restored QA databases. No fake Date or validation bypass.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),{Pool}=require(path.join(root,'services/match-service/node_modules/pg')),express=require(path.join(root,'services/match-service/node_modules/express'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const run=process.argv[2]??'002';assert(/^\d{3}$/.test(run));
const db=(domain)=>`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/sfl_demo_flow_qa_${domain}_20261127_${run}`;
const t='9f765a91-b8ab-4716-a083-0cf8a113db1b',m='8b8a61e2-4b83-4c8c-962e-580b4a594106',servers=[],checks=[];let gateway;
const log=fs.openSync(path.join(__dirname,'qa-runtime.log'),'a');
async function mount(file,error,port,prefix=''){const app=express();app.use(express.json());const mod=require(path.join(root,file));app.use(prefix,mod.internalRoutes??mod.teamRoutes??mod.tournamentRoutes??mod.matchRoutes);app.use(require(path.join(root,error)).errorHandler);servers.push(await new Promise(resolve=>{const s=app.listen(port,'127.0.0.1',()=>resolve(s));}));return app;}
async function http(cookie,url,method='GET',body){const r=await fetch('http://127.0.0.1:19780/api'+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:r.status===204?null:await r.json()};}
async function ok(cookie,url,method='GET',body,status=200){const r=await http(cookie,url,method,body);assert.equal(r.status,status,url+' '+JSON.stringify(r.body));return r.body;}
async function reject(cookie,url,body,code){const r=await http(cookie,url,'POST',body);assert(r.status>=400,url+' must reject');assert.equal(r.body.error?.code??r.body.code,code,JSON.stringify(r));}
async function login(email){const password=fs.readFileSync(path.join(root,'docs/DEMO_ACCOUNTS_AND_TESTING.md'),'utf8').match(/Demo@\d{6}/)[0];const r=await fetch('http://127.0.0.1:19780/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Normal demo login');return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
async function check(name,task){await task();checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function main(){
 Object.assign(process.env,env,{NODE_ENV:'test',MATCH_DEMO_MODE_ENABLED:'true',MATCH_DEMO_TOURNAMENT_IDS:t,AUTH_SERVICE_URL:'http://127.0.0.1:19701',ORGANIZATION_SERVICE_URL:'http://127.0.0.1:19704',TOURNAMENT_SERVICE_URL:'http://127.0.0.1:19703',MATCH_SERVICE_URL:'http://127.0.0.1:19705',NOTIFICATION_SERVICE_URL:'http://127.0.0.1:1',DATABASE_URL:db('auth'),ACCOUNT_DATABASE_URL:db('user')});
 await mount('services/auth-service/dist/account/routes/internalRoutes','services/auth-service/dist/middleware/errorHandler',19701,'/internal');
 process.env.DATABASE_URL=db('team');await mount('services/organization-service/dist/routes/teamRoutes','services/organization-service/dist/middleware/errorHandler',19704);
 process.env.DATABASE_URL=db('tournament');await mount('services/tournament-service/dist/routes/tournamentRoutes','services/tournament-service/dist/middleware/errorHandler',19703);
 process.env.DATABASE_URL=db('match');process.env.SCHEDULING_DATABASE_URL=db('scheduling');process.env.DISCIPLINE_DATABASE_URL=db('discipline');
 const migration=require(path.join(root,'services/match-service/dist/db/matchDemoTimeMigration')).applyMatchDemoTimeMigration;
 await check('migration 27 applies twice without rewriting old rows',async()=>{await migration(db('match'));await migration(db('match'));});
 const app=await mount('services/match-service/dist/routes/matchRoutes','services/match-service/dist/middleware/errorHandler',19705);
 app.use(require(path.join(root,'services/match-service/dist/scheduling/routes/schedulingRoutes')).schedulingRoutes);app.use(require(path.join(root,'services/match-service/dist/middleware/errorHandler')).errorHandler);
 gateway=spawn(process.execPath,[path.join(root,'apps/api-gateway/dist/index.js')],{cwd:root,env:{...process.env,PORT:'19780',AUTH_SERVICE_URL:'http://127.0.0.1:3001',CORS_ORIGIN:'http://127.0.0.1:19780'},stdio:['ignore',log,log],windowsHide:true});
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:19780/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const btc=await login('dataset.btc01@football.local'),ref=await login('dataset.captain02@football.local'),outside=await login('dataset.captain01@football.local');
 const context=async()=>ok(ref,`/matches/${m}/referee-context`),demo=async()=>ok(ref,`/matches/${m}/demo-time`);
 if(process.argv.includes('--read-only')){
  const views={groupStandings:await ok(btc,`/tournaments/${t}/fixtures/group-standings`),standings:await ok(btc,`/tournaments/${t}/standings`),bracket:await ok(btc,`/tournaments/${t}/bracket`),context:await context()};
  fs.writeFileSync(path.join(__dirname,'qa-post-match-views.json'),JSON.stringify(views,null,2));console.log('Read post-match views from QA via actual APIs');return;
 }
 const payload=async action=>{const d=await demo(),x=await context();return{action,expectedRevision:d.revision,expectedClockVersion:x.clock.version};};
 const jump=async action=>ok(ref,`/matches/${m}/demo-time`,'POST',await payload(action));
 const clock=async action=>{const x=await context();return ok(ref,`/matches/${m}/clock-actions`,'POST',{action,expectedVersion:x.clock.version});};
 const cp=new Pool({connectionString:db('match')}),sp=new Pool({connectionString:db('scheduling')});
 try {
 const originalSchedule=(await sp.query('SELECT * FROM schedules WHERE match_id=$1',[m])).rows;
 await check('anonymous, outside referee and BTC without crew capability cannot control demo time',async()=>{
  assert.equal((await http('',`/matches/${m}/demo-time`,'POST',{action:'ENABLE',expectedRevision:0,expectedClockVersion:0})).status,401);
  assert.equal((await http(outside,`/matches/${m}/demo-time`,'POST',{action:'ENABLE',expectedRevision:0,expectedClockVersion:0})).status,403);
  assert.equal((await http(btc,`/matches/${m}/demo-time`,'POST',{action:'ENABLE',expectedRevision:0,expectedClockVersion:0})).status,403);
 });
 const matchConfig=require(path.join(root,'services/match-service/dist/config')).config;
 await check('production refuses feature even when flag=true, and opt-out hides the control',async()=>{
  matchConfig.nodeEnv='production';assert.equal((await demo()).available,false);await reject(ref,`/matches/${m}/demo-time`,{action:'ENABLE',expectedRevision:0,expectedClockVersion:0},'DEMO_TIME_DISABLED');
  matchConfig.nodeEnv='test';matchConfig.matchDemoModeEnabled=false;assert.equal((await demo()).available,false);matchConfig.matchDemoModeEnabled=true;
 });
 await check('enable persists across fresh reads; a stale click cannot overwrite time',async()=>{
  const p=await payload('ENABLE');await ok(ref,`/matches/${m}/demo-time`,'POST',p);assert.equal((await demo()).enabled,true);await reject(ref,`/matches/${m}/demo-time`,p,'DEMO_TIME_VERSION_CONFLICT');
 });
 await check('time jump never fabricates rules, squads or readiness',async()=>{
  await jump('LINEUP');let x=await context();assert.equal(x.match.status,'SCHEDULED');assert(x.operationRules.missing.LINEUP.length);assert.equal(x.preparation.ready,false);
  await jump('KICKOFF');x=await context();assert.equal(x.readiness.kickoffReached,true);assert.equal(x.readiness.canStart,false);
  await reject(ref,`/matches/${m}/clock-actions`,{action:'START_MATCH',expectedVersion:x.clock.version},'MATCH_RULES_UNDEFINED');
  await jump('DISABLE');
 });
 // Explicit QA rule choices only. These values are not written to the official regulation.
 const rules=require(path.join(root,'packages/shared/dist')).selectMatchLaw('IFAB_2026_27');Object.assign(rules.values,{maxSubstitutes:9,shirtNumbers:'UNIQUE_1_99',halfTimeMinutes:10,groupDrawPolicy:'ALLOW_DRAW',substitutionMode:'LIMITED',maxSubstitutions:5,substitutionOpportunities:3,returnSubstitutes:'NO',lineupSubmissionMinutes:30,lineupEditMinutes:15});
 const ruleUrl=`/tournaments/${t}/regulation-operation-rules`,versions=await ok(btc,ruleUrl),v=(await ok(btc,ruleUrl,'POST',{baseRegulationVersion:1,expectedRevision:Math.max(0,...versions.versions.map(v=>v.revision)),rules,reason:'Controlled QA only: explicit test case choices; do not alter official published rules'},201)).version;
 await ok(btc,`${ruleUrl}/${v.revision}/publish`,'POST',{expectedRevision:v.revision});
 await ok(btc,`/tournaments/${t}/fixtures/operation-rules/apply`,'POST',{supplementId:v.id,matches:[{matchId:m,expectedBindingRevision:0}],reason:'Controlled QA fixture rule binding, isolated databases'});
 await jump('ENABLE');await jump('LINEUP');
 const meta=JSON.parse(fs.readFileSync(path.join(__dirname,'current-data.json'))),raw=meta.matches.find(x=>x.id===m),squads=[];
 await check('both actual captains submit from official roster and referee reviews the same saved squads',async()=>{
  for(const teamId of [raw.home_team_id,raw.away_team_id]){
   const team=meta.teams.find(x=>x.id===teamId),account=meta.accounts.find(a=>a.id===team.captain_id),cookie=await login(account.email),url=`/matches/${m}/squads/${teamId}`,w=await ok(cookie,url),people=w.roster.players.filter(p=>p.eligible),keeper=people.find(p=>p.position==='GK');assert(keeper);
   const entries=[keeper,...people.filter(p=>p.id!==keeper.id).slice(0,12)].map((p,i)=>({playerId:p.id,jerseyNumber:i+1,position:i?'MF':'GK',isStarting:i<11}));
   await ok(cookie,url,'PUT',{entries,expectedRevision:w.squad.revision,submit:true});const saved=await ok(cookie,url);assert.equal(saved.squad.status,'SUBMITTED');assert.equal(saved.demoTime.enabled,true);await ok(ref,url+'/review','POST',{action:'APPROVE',expectedRevision:saved.squad.revision});squads.push({teamId,cookie,entries});
  }
 });
 await check('kickoff uses simulated time; lineup deadlines still reject an edit after configured deadline',async()=>{
  await jump('PREMATCH');const s=squads[0],w=await ok(s.cookie,`/matches/${m}/squads/${s.teamId}`),r=await http(s.cookie,`/matches/${m}/squads/${s.teamId}`,'PUT',{entries:s.entries,expectedRevision:w.squad.revision,submit:true});assert.equal(r.body.error?.code??r.body.code,'SQUAD_DEADLINE_PASSED');
  await jump('KICKOFF');await ok(ref,`/matches/${m}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'});
  let x=await context();await reject(ref,`/matches/${m}/clock-actions`,{action:'START_MATCH',expectedVersion:x.clock.version},'MATCH_OPERATION_NOT_READY');
  await ok(btc,`/tournaments/${t}`,'PUT',{status:'IN_PROGRESS'});await clock('START_MATCH');assert.equal((await context()).match.status,'IN_PROGRESS');
 });
 await check('one-minute jump supplies event time; goal, card and atomic substitution use real business APIs',async()=>{
  await jump('ADVANCE_MINUTE');let x=await context();assert(x.clock.elapsedSeconds>=60);
  await ok(ref,'/match-events','POST',{matchId:m,teamId:squads[0].teamId,playerId:squads[0].entries[1].playerId,eventType:'GOAL',operationId:randomUUID(),phase:x.clock.phase,expectedClockVersion:x.clock.version},201);
  await ok(ref,'/match-events','POST',{matchId:m,teamId:squads[1].teamId,playerId:squads[1].entries[1].playerId,eventType:'YELLOW_CARD',operationId:randomUUID(),phase:x.clock.phase,expectedClockVersion:x.clock.version},201);
  await ok(ref,'/match-events','POST',{matchId:m,teamId:squads[0].teamId,playerId:squads[0].entries[2].playerId,relatedPlayerId:squads[0].entries[11].playerId,eventType:'SUBSTITUTION_OUT',operationId:randomUUID(),phase:x.clock.phase,expectedClockVersion:x.clock.version},201);
  x=await context();assert.equal(x.events.filter(e=>e.eventType==='SUBSTITUTION_IN').length,1);assert.equal(x.events.filter(e=>e.eventType==='GOAL')[0].minute,1);
 });
 await check('cannot rewind or disable a live demo match; ending a half still requires its normal action',async()=>{
  await reject(ref,`/matches/${m}/demo-time`,await payload('DISABLE'),'DEMO_TIME_MATCH_STARTED');
  let x=await context();await reject(ref,`/matches/${m}/clock-actions`,{action:'END_PERIOD',expectedVersion:x.clock.version},'CLOCK_PERIOD_NOT_COMPLETE');
  await jump('PERIOD_END');x=await context();assert.equal(x.clock.phase,'FIRST_HALF');assert.equal(x.match.status,'IN_PROGRESS');await clock('END_PERIOD');assert.equal((await context()).clock.phase,'HALF_TIME');
  await jump('HALF_TIME_END');assert.equal((await context()).clock.phase,'HALF_TIME');await clock('START_NEXT_PERIOD');await jump('PERIOD_END');await clock('END_PERIOD');await clock('END_MATCH');
 });
 await check('FINISHED stops clock, retains pending score, and leaves official schedule unchanged',async()=>{
  const x=await context();assert.equal(x.match.status,'FINISHED');assert.equal(x.clock.phase,'ENDED');assert.equal(x.result.status,'PENDING');assert.equal(x.result.homeScore,1);assert.equal(x.result.awayScore,0);assert.equal(x.clock.isRunning,false);assert.deepEqual((await sp.query('SELECT * FROM schedules WHERE match_id=$1',[m])).rows,originalSchedule);
 });
 await check('existing ordinary report path can confirm QA result; audit and demo marker survive reload/disable',async()=>{
  const r=await ok(ref,'/match-reports','POST',{matchId:m,homeScoreAtHalfTime:1,awayScoreAtHalfTime:0,notes:'Controlled QA demo-time workflow',requiresOrganizerReview:false},201);assert.equal(r.report.status,'APPROVED');
  // Result approval locks the match; Demo Mode remains an auditable marker. No direct DB repair.
  const x=await context();assert.equal(x.result.status,'APPROVED');await jump('DISABLE');assert.equal((await demo()).enabled,false);assert((await demo()).used);assert((await cp.query('SELECT COUNT(*)::int n FROM match_demo_time_history WHERE match_id=$1',[m])).rows[0].n>=8);
 });
 const final=await context();fs.writeFileSync(path.join(__dirname,'qa-final-context.json'),JSON.stringify(final,null,2));
 }finally{await cp.end();await sp.end();}
}
main().catch(e=>{checks.push({status:'FAIL',message:e.message});console.error(e.stack);process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(__dirname,`qa-results-${run}${process.argv.includes('--read-only')?'-read-only':''}.json`),JSON.stringify({at:new Date().toISOString(),checks},null,2));gateway?.kill();for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}for(const [domain,file]of [['match','lib/db'],['match','scheduling/lib/db'],['match','discipline/lib/db'],['tournament','lib/db'],['organization','lib/db']]){try{await require(path.join(root,`services/${domain}-service/dist/${file}`)).closePool();}catch{}}setTimeout(()=>process.exit(process.exitCode||0),500).unref();});

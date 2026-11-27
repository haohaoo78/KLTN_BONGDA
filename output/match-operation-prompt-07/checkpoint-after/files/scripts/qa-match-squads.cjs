// Prompt 3 controlled QA: normal Auth + Gateway, real service routers and four
// restored PostgreSQL databases. No official match/fixture/schedule mutations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/match-operation-prompt-04');
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const express=require(path.join(root,'services/match-service/node_modules/express'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const runId=process.argv[2]||'001';assert(/^\d{3}$/.test(runId));
const qa=name=>`sfl_prompt04_qa_${name}_20261126_${runId}`;
function db(name,readOnly=false){assert(/^sfl_(prompt04_qa_|auth$|user$|tournament$|match$|scheduling$|discipline$|team$)/.test(name));const u=new URL(`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/${name}`);if(readOnly)u.searchParams.set('options','-c default_transaction_read_only=on');return u.toString();}
const tourId='9f765a91-b8ab-4716-a083-0cf8a113db1b',aId='8b8a61e2-4b83-4c8c-962e-580b4a594106';
const checks=[],servers=[],startedAt=new Date().toISOString();let gateway,timeMock;
const gatewayLog=fs.openSync(path.join(out,`qa-gateway-${runId}.log`),'a');
async function snapshot(name){const p=new Pool({connectionString:db(name,true)}),c=await p.connect(),result={};try{
  await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  for(const {tablename:t}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){assert(/^[a-z_0-9]+$/.test(t));result[t]=(await c.query(`SELECT COUNT(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${t}" t`)).rows[0];}
  await c.query('COMMIT');return result;
}finally{c.release();await p.end();}}
async function officialSnapshot(){return Object.fromEntries(await Promise.all(['tournament','match','scheduling','discipline','team'].map(async name=>[name,await snapshot('sfl_'+name)])));}
async function check(name,task){await task();checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function http(cookie,endpoint,method='GET',body){const r=await fetch('http://127.0.0.1:19480/api'+endpoint,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?null:await r.json()};}
async function ok(cookie,endpoint,method='GET',body,status=200){const r=await http(cookie,endpoint,method,body);assert.equal(r.status,status,endpoint+' '+JSON.stringify(r.body));return r.body;}
async function login(email){const password=fs.readFileSync(path.join(root,'docs/DEMO_ACCOUNTS_AND_TESTING.md'),'utf8').match(/Demo@\d{6}/)?.[0];assert(password);const r=await fetch('http://127.0.0.1:19480/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Normal Auth login');const data=await r.json();return {cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),data};}
async function listen(app,port){servers.push(await new Promise((resolve,reject)=>{const server=app.listen(port,'127.0.0.1',()=>resolve(server));server.on('error',reject);}));}
async function mount(routerPath,errorPath,port,prefix=''){const app=express();app.use(express.json());app.use(prefix,require(path.join(root,routerPath)).internalRoutes??require(path.join(root,routerPath)).tournamentRoutes??require(path.join(root,routerPath)).matchRoutes??require(path.join(root,routerPath)).teamRoutes);app.use(require(path.join(root,errorPath)).errorHandler);await listen(app,port);return app;}
async function main(){
 const before=await officialSnapshot();{const proof=path.join(out,`database-before-${runId}.json`);if(fs.existsSync(proof))assert.deepEqual(JSON.parse(fs.readFileSync(proof,'utf8')),before);else fs.writeFileSync(proof,JSON.stringify(before,null,2),{flag:'wx'});}
 Object.assign(process.env,env,{NODE_ENV:'test',AUTH_SERVICE_URL:'http://127.0.0.1:19401',ORGANIZATION_SERVICE_URL:'http://127.0.0.1:19404',TOURNAMENT_SERVICE_URL:'http://127.0.0.1:19403',MATCH_SERVICE_URL:'http://127.0.0.1:19405',NOTIFICATION_SERVICE_URL:'http://127.0.0.1:1',DATABASE_URL:db('sfl_auth',true),ACCOUNT_DATABASE_URL:db('sfl_user',true)});
 await mount('services/auth-service/dist/account/routes/internalRoutes','services/auth-service/dist/middleware/errorHandler',19401,'/internal');
 process.env.DATABASE_URL=db(qa('team'));await mount('services/organization-service/dist/routes/teamRoutes','services/organization-service/dist/middleware/errorHandler',19404);
 process.env.DATABASE_URL=db(qa('tournament'));await mount('services/tournament-service/dist/routes/tournamentRoutes','services/tournament-service/dist/middleware/errorHandler',19403);
 process.env.DATABASE_URL=db(qa('match'));process.env.SCHEDULING_DATABASE_URL=db(qa('scheduling'));process.env.DISCIPLINE_DATABASE_URL=db(qa('discipline'));
 await require(path.join(root,'services/match-service/dist/db/matchSquadMigration')).applyMatchSquadMigration(db(qa('match')));
 const app=await mount('services/match-service/dist/routes/matchRoutes','services/match-service/dist/middleware/errorHandler',19405);app.use(require(path.join(root,'services/match-service/dist/scheduling/routes/schedulingRoutes')).schedulingRoutes);app.use(require(path.join(root,'services/match-service/dist/discipline/routes/disciplineRoutes')).disciplineRoutes);app.use(require(path.join(root,'services/match-service/dist/middleware/errorHandler')).errorHandler);
 gateway=spawn(process.execPath,[path.join(root,'apps/api-gateway/dist/index.js')],{cwd:root,env:{...process.env,PORT:'19480',AUTH_SERVICE_URL:'http://127.0.0.1:3001',CORS_ORIGIN:'http://127.0.0.1:19480'},stdio:['ignore',gatewayLog,gatewayLog],windowsHide:true});
 for(let i=0;i<60;i++){try{if((await fetch('http://127.0.0.1:19480/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const btc=(await login('dataset.btc01@football.local')).cookie,ref=(await login('dataset.captain02@football.local')).cookie,outside=(await login('dataset.captain01@football.local')).cookie;
 const m=(await ok(btc,`/matches/${aId}`)).match;
 // Resolve the existing team captains by their real Auth identities, without changing roles/accounts.
 const orgPool=new Pool({connectionString:db(qa('team'))});const teams=(await orgPool.query('SELECT id,captain_id FROM teams WHERE id=ANY($1::uuid[])',[[m.homeTeamId,m.awayTeamId]])).rows;await orgPool.end();
 const authPool=new Pool({connectionString:db('sfl_user',true)});let identities;try{identities=(await authPool.query('SELECT id,email FROM users WHERE id=ANY($1::uuid[])',[teams.map(t=>t.captain_id)])).rows;}finally{await authPool.end();}
 const captains=new Map();for(const t of teams){const email=identities.find(u=>u.id===t.captain_id)?.email;assert(email,'Existing captain identity');captains.set(t.id,(await login(email)).cookie);}
 const home=captains.get(m.homeTeamId),away=captains.get(m.awayTeamId),url=id=>`/matches/${aId}/squads/${id}`,hurl=url(m.homeTeamId),aurl=url(m.awayTeamId);
 let hw=await ok(home,hurl),aw=await ok(away,aurl);
 await check('captain can read the official approved roster of its own team',async()=>{assert.equal(hw.roster.registrationStatus,'APPROVED');assert(hw.roster.players.filter(p=>p.eligible).length>=11);assert.equal(hw.squad.revision,0);});
 await check('another captain cannot read or write this team squad',async()=>{assert.equal((await http(away,hurl)).status,403);assert.equal((await http(away,hurl,'PUT',{entries:[],expectedRevision:0})).status,403);});
 await check('an unassigned referee cannot review either team',async()=>assert.equal((await http(outside,`/matches/${aId}/squads/${m.homeTeamId}/review`,'POST',{action:'APPROVE',expectedRevision:0})).status,403));
 await check('no lineups cannot be made ready from the frontend request',async()=>assert.equal((await http(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'})).status,409));
 await check('generic match update cannot bypass the lineup workflow',async()=>{const r=await http(btc,`/matches/${aId}`,'PUT',{status:'LINEUP_CONFIRMED'});assert.equal(r.status,409);assert.equal(r.body.error.code,'MATCH_LINEUPS_WORKFLOW_REQUIRED');});
 await check('missing published lineup rules block submit rather than inventing values',async()=>{const r=await http(home,hurl,'PUT',{entries:[],expectedRevision:0,submit:true});assert.equal(r.status,409);assert(r.body.error.details.issues.some(i=>i.code==='MATCH_RULES_UNDEFINED'));});
 const rules=require(path.join(root,'packages/shared/dist')).selectMatchLaw('IFAB_2026_27');Object.assign(rules.values,{maxSubstitutes:9,shirtNumbers:'UNIQUE_1_99',lineupSubmissionMinutes:0,lineupEditMinutes:0,halfTimeMinutes:10,groupDrawPolicy:'ALLOW_DRAW',substitutionMode:'LIMITED',maxSubstitutions:5,substitutionOpportunities:3,returnSubstitutes:'NO'});
 const ruleUrl=`/tournaments/${tourId}/regulation-operation-rules`,version=(await ok(btc,ruleUrl,'POST',{baseRegulationVersion:1,expectedRevision:0,rules,reason:'Explicit controlled QA rules for match-squad regression; original official regulations remain unchanged'},201)).version;
 await ok(btc,`${ruleUrl}/${version.revision}/publish`,'POST',{expectedRevision:version.revision});await ok(btc,`/tournaments/${tourId}/fixtures/operation-rules/apply`,'POST',{supplementId:version.id,matches:[{matchId:aId,expectedBindingRevision:0}],reason:'Apply only to the restored QA fixture for F02'});
 hw=await ok(home,hurl);aw=await ok(away,aurl);
 const entries=w=>{const people=w.roster.players.filter(p=>p.eligible),keeper=people.find(p=>p.position==='GK');assert(keeper,'Real roster goalkeeper');return [keeper,...people.filter(p=>p.id!==keeper.id).slice(0,10)].map((p,i)=>({playerId:p.id,jerseyNumber:i+1,position:i?'MF':'GK',isStarting:true}));};
 let he=entries(hw),ae=entries(aw);
 await check('explicit QA deadlines are enforced without production defaults',async()=>{
  timeMock=require('node:test').mock.timers;timeMock.enable({apis:['Date'],now:Date.parse(hw.schedule.scheduledDate)+60000});
  try{const r=await http(home,hurl,'PUT',{entries:he,expectedRevision:0,submit:true});assert.equal(r.status,409);assert.equal(r.body.error.code,'SQUAD_DEADLINE_PASSED');}finally{timeMock.reset();timeMock=null;}
 });
 async function invalid(name,body,code){await check(name,async()=>{const r=await http(home,hurl,'PUT',{entries:body,expectedRevision:0,submit:true});assert.equal(r.status,409,JSON.stringify(r.body));assert(r.body.error.details.issues.some(i=>i.code===code),JSON.stringify(r.body));assert.equal((await ok(home,hurl)).squad.revision,0);});}
 const publicTeam=await fetch(`http://127.0.0.1:19404/public/teams/${m.homeTeamId}`,{headers:{'x-gateway-internal-key':env.INTERNAL_API_KEY}}).then(r=>r.json());
 const outsider=publicTeam.players.find(p=>!hw.roster.players.some(r=>r.id===p.id));
 if(outsider)await invalid('active club player outside the official tournament roster is rejected',[...he.slice(0,10),{...he[10],playerId:outsider.id}],'SQUAD_PLAYER_INELIGIBLE');else await check('active club player outside the official roster is rejected using the existing round-robin club',async()=>{
  const rr=(await ok(btc,'/tournaments/248006af-5af3-4ff5-8486-47b80fc269b9/matches?limit=100')).items[0];assert(rr);
  const p=new Pool({connectionString:db(qa('team'))}),q=new Pool({connectionString:db('sfl_user',true)});let email;
  try{const t=(await p.query('SELECT captain_id FROM teams WHERE id=$1',[rr.homeTeamId])).rows[0];email=(await q.query('SELECT email FROM users WHERE id=$1',[t.captain_id])).rows[0].email;}finally{await p.end();await q.end();}
  const captain=(await login(email)).cookie,u=`/matches/${rr.id}/squads/${rr.homeTeamId}`,w=await ok(captain,u);
  const detail=await fetch(`http://127.0.0.1:19404/public/teams/${rr.homeTeamId}`,{headers:{'x-gateway-internal-key':env.INTERNAL_API_KEY}}).then(r=>r.json()),pOutside=detail.players.find(p=>!w.roster.players.some(r=>r.id===p.id));assert(pOutside,'Existing club member outside this tournament roster');
  const rejected=await http(captain,u,'PUT',{entries:[{playerId:pOutside.id,jerseyNumber:99,position:'MF',isStarting:true}],expectedRevision:0});assert.equal(rejected.status,409);assert(rejected.body.error.details.issues.some(i=>i.code==='SQUAD_PLAYER_INELIGIBLE'));
 });
 await invalid('player from another team/tournament is rejected',[...he.slice(0,10),ae[10]],'SQUAD_PLAYER_INELIGIBLE');
 await check('withdrawn real player is ineligible in the roster API and cannot enter a match squad',async()=>{
  const p=new Pool({connectionString:db(qa('team'))});let withdrawn;try{withdrawn=(await p.query("SELECT i.player_id,i.team_id,i.tournament_id FROM tournament_player_invitations i JOIN rosters r ON r.player_id=i.player_id AND r.team_id=i.team_id AND r.tournament_id=i.tournament_id WHERE i.status='WITHDRAWN' ORDER BY i.id LIMIT 1")).rows[0];}finally{await p.end();}assert(withdrawn,'Existing genuine withdrawn invitation');
  const source=await fetch(`http://127.0.0.1:19404/internal/tournaments/${withdrawn.tournament_id}/teams/${withdrawn.team_id}/match-roster`,{headers:{'x-gateway-internal-key':env.INTERNAL_API_KEY}}).then(r=>r.json()),player=source.roster.players.find(p=>p.id===withdrawn.player_id);assert(player);assert.equal(player.eligible,false);assert(player.reasons.some(r=>r.includes('rút')));
  const r=await http(home,hurl,'PUT',{entries:[{...he[0],playerId:withdrawn.player_id}],expectedRevision:0});assert.equal(r.status,409);assert(r.body.error.details.issues.some(i=>i.code==='SQUAD_PLAYER_INELIGIBLE'));
 });
 await invalid('duplicate player is rejected atomically',[...he,he[1]],'SQUAD_DUPLICATE_PLAYER');
 await invalid('duplicate shirt is rejected with a player field error',he.map((p,i)=>i===1?{...p,jerseyNumber:1}:p),'SQUAD_DUPLICATE_SHIRT');
 await invalid('too few starters cannot be submitted',he.slice(0,5),'SQUAD_TOO_FEW_PLAYERS');
 await invalid('missing goalkeeper cannot be submitted',he.map(p=>({...p,position:'MF'})),'SQUAD_GOALKEEPER_REQUIRED');
 const ban=(await ok(btc,'/suspensions','POST',{playerId:he[2].playerId,tournamentId:tourId,teamId:m.homeTeamId,type:'DISCIPLINARY',startDate:'2026-12-17T00:00:00.000Z',endDate:'2026-12-19T23:00:00.000Z',reason:'Controlled QA pre-match eligibility regression'},201)).suspension;
 await invalid('suspension is evaluated for the scheduled match date',he,'SQUAD_PLAYER_INELIGIBLE');await ok(btc,`/suspensions/${ban.id}/lift`,'PUT',{});
 await check('draft saves atomically and survives a fresh read without becoming submitted',async()=>{await ok(home,hurl,'PUT',{entries:he.slice(0,2),expectedRevision:0});const w=await ok(home,hurl);assert.equal(w.squad.revision,1);assert.equal(w.squad.status,'DRAFT');assert.equal(w.squad.entries.length,2);assert.equal((await ok(ref,`/matches/${aId}/referee-context`)).preparation.ready,false);});
 await check('draft lineup is not exposed by the public lineup endpoint',async()=>assert.equal((await ok(home,`/matches/${aId}/lineups`)).lineups.length,0));
 await check('two clients with the same revision cannot overwrite one another',async()=>{const r=await Promise.all([http(home,hurl,'PUT',{entries:he,expectedRevision:1}),http(home,hurl,'PUT',{entries:he.slice(0,3),expectedRevision:1})]);assert.deepEqual(r.map(r=>r.status).sort(),[200,409]);assert.equal((await ok(home,hurl)).squad.revision,2);});
 await ok(home,hurl,'PUT',{entries:he,expectedRevision:2,submit:true});
 await check('bulk and legacy POST/DELETE share the same revision guard',async()=>{for(const r of [await http(home,hurl,'PUT',{entries:he,expectedRevision:2}),await http(home,'/lineups','POST',{matchId:aId,teamId:m.homeTeamId,...he[0],expectedRevision:2}),await http(home,`/matches/${aId}/lineups/${m.homeTeamId}`,'DELETE',{expectedRevision:2})])assert.equal(r.status,409);});
 await check('permitted edits before readiness clear prior submission and can be submitted again',async()=>{await ok(home,hurl,'PUT',{entries:he,expectedRevision:3});let w=await ok(home,hurl);assert.equal(w.squad.status,'DRAFT');assert.equal(w.squad.reviewedAt,null);await ok(home,`/matches/${aId}/lineups/${m.homeTeamId}/confirm`,'PUT',{expectedRevision:w.squad.revision},204);assert.equal((await ok(home,hurl)).squad.status,'SUBMITTED');});
 await check('one submitted team is not enough to confirm the match',async()=>assert.equal((await http(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'})).status,409));
 await ok(away,aurl,'PUT',{entries:ae,expectedRevision:0,submit:true});
 await check('captain submission remains distinct from referee on-site review',async()=>{const p=(await ok(ref,`/matches/${aId}/preparation`)).preparation;assert(p.squads.every(s=>s.status==='SUBMITTED'&&!s.reviewedAt));assert.equal(p.ready,false);assert.equal((await http(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'})).status,409);});
 for(const [id,who]of [[m.homeTeamId,home],[m.awayTeamId,away]]){const w=await ok(who,url(id));await ok(ref,`/matches/${aId}/squads/${id}/review`,'POST',{action:'APPROVE',expectedRevision:w.squad.revision});}
 await check('referee reviews are visible to the captain after reload',async()=>{assert((await ok(home,hurl)).squad.reviewedAt);assert.equal((await ok(ref,`/matches/${aId}/preparation`)).preparation.ready,true);});
 await ok(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'});
 await check('ordinary edit after readiness is blocked, without deleting the saved players',async()=>{const w=await ok(home,hurl);assert.equal((await http(home,hurl,'PUT',{entries:[],expectedRevision:w.squad.revision})).status,409);assert.equal((await ok(home,hurl)).squad.entries.length,11);});
 await check('authorized request for changes invalidates readiness and retains history',async()=>{const w=await ok(home,hurl);await ok(ref,`/matches/${aId}/squads/${m.homeTeamId}/review`,'POST',{action:'REQUEST_CHANGES',expectedRevision:w.squad.revision,note:'QA: check one shirt on site before submitting again'});const changed=await ok(home,hurl);assert.equal(changed.match.status,'SCHEDULED');assert.equal(changed.squad.status,'CHANGES_REQUESTED');assert(changed.history.some(h=>h.action==='CHANGES_REQUESTED'));});
 hw=await ok(home,hurl);await ok(home,hurl,'PUT',{entries:he,expectedRevision:hw.squad.revision,submit:true});hw=await ok(home,hurl);await ok(ref,`/matches/${aId}/squads/${m.homeTeamId}/review`,'POST',{action:'APPROVE',expectedRevision:hw.squad.revision});
 const issue=await ok(ref,`/matches/${aId}/preparation/issues`,'POST',{kind:'VENUE_UNSAFE',description:'QA on-site venue issue requiring an explicit organizer decision'},201);
 await check('open on-site issue blocks readiness and does not impose a forfeit',async()=>{assert.equal((await ok(ref,`/matches/${aId}/preparation`)).preparation.ready,false);assert.equal((await http(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'})).status,409);assert.equal((await ok(btc,`/matches/${aId}`)).match.status,'SCHEDULED');});
 await ok(btc,`/matches/${aId}/preparation/organizer`,'POST',{action:'RESOLVE_ISSUE',issueId:issue.id,reason:'QA organizer confirms that the documented venue issue was corrected'});
 await ok(ref,`/matches/${aId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'});
 const bId='e45a599b-1377-4377-9016-3956cc4e0738';
 await check('legacy ready status without lineups is detected without auto-repair',async()=>{const beforeStatus=(await ok(btc,`/matches/${bId}`)).match.status;assert.equal((await ok(btc,`/matches/${bId}/preparation`)).preparation.inconsistent,true);assert.equal((await ok(btc,`/matches/${bId}`)).match.status,beforeStatus);});
 await check('organizer can reopen inconsistent preparation with an audited reason',async()=>{await ok(btc,`/matches/${bId}/preparation/organizer`,'POST',{action:'REOPEN',reason:'Controlled QA: reopen the inconsistent legacy pre-match status; do not invent a lineup'});assert.equal((await ok(btc,`/matches/${bId}`)).match.status,'SCHEDULED');});
 await ok(btc,`/tournaments/${tourId}`,'PUT',{status:'IN_PROGRESS'});
 timeMock=require('node:test').mock.timers;timeMock.enable({apis:['Date'],now:Date.parse(hw.schedule.scheduledDate)+60000});
 const lateBan=(await ok(btc,'/suspensions','POST',{playerId:he[2].playerId,tournamentId:tourId,teamId:m.homeTeamId,type:'DISCIPLINARY',startDate:'2026-12-17T00:00:00.000Z',endDate:'2026-12-19T23:00:00.000Z',reason:'QA: new eligibility change after readiness'},201)).suspension;
 await check('START_MATCH rechecks eligibility changed after readiness',async()=>{const r=await http(ref,`/matches/${aId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0});assert.equal(r.status,409);assert.equal(r.body.error.code,'MATCH_LINEUPS_NOT_READY');});await ok(btc,`/suspensions/${lateBan.id}/lift`,'PUT',{});
 await check('valid submitted and reviewed lineups permit a real QA kickoff',async()=>{const r=await ok(ref,`/matches/${aId}/clock-actions`,'POST',{action:'START_MATCH',expectedVersion:0});assert.equal(r.clock.phase,'FIRST_HALF');});
 await check('started lineups cannot be cleared or changed through ordinary squad APIs',async()=>{hw=await ok(home,hurl);assert.equal((await http(home,hurl,'PUT',{entries:[],expectedRevision:hw.squad.revision})).status,409);assert.equal((await http(home,`/matches/${aId}/lineups/${m.homeTeamId}`,'DELETE',{expectedRevision:hw.squad.revision})).status,409);assert.equal((await ok(home,hurl)).squad.entries.length,11);});
 timeMock.reset();timeMock=null;
 await check('official five business databases are unchanged by QA',async()=>assert.deepEqual(await officialSnapshot(),before));
 fs.writeFileSync(path.join(out,`qa-api-${runId}.json`),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),checks},null,2));
}
main().catch(error=>{checks.push({name:'QA execution',status:'FAIL',reason:error.message});fs.writeFileSync(path.join(out,`qa-api-${runId}.json`),JSON.stringify({startedAt,checks},null,2));console.error(error.stack);process.exitCode=1;}).finally(async()=>{
 timeMock?.reset();gateway?.kill();for(const server of servers)server.closeAllConnections?.();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
 for(const name of ['services/tournament-service/dist/lib/db','services/match-service/dist/lib/db','services/match-service/dist/scheduling/lib/db','services/match-service/dist/discipline/lib/db','services/auth-service/dist/account/lib/db','services/organization-service/dist/lib/db']){const mod=require.cache[require.resolve(path.join(root,name))];if(mod?.exports.closePool)await mod.exports.closePool();}
});

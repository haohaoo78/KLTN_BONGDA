// Prompt 9: real PostgreSQL restores + official APIs + normal Auth session.
// No mutations to original tournament/match/scheduling/roster databases.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,fork}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/match-operation-prompt-09');
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg')),express=require(path.join(root,'services/match-service/node_modules/express'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const runId=process.argv[2]||'001';assert(/^\d{3}$/.test(runId));
const evidenceId=runId+(process.argv[3]==='browser'?'-browser':'');
const qa=name=>`sfl_prompt09_qa_${name}_20261128_${runId}`;
function db(name,readOnly=false){assert(/^sfl_(prompt09_qa_|auth$|user$|tournament$|match$|scheduling$|discipline$|team$)/.test(name));const u=new URL(`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/${name}`);if(readOnly)u.searchParams.set('options','-c default_transaction_read_only=on');return u.toString();}
const tourId='9f765a91-b8ab-4716-a083-0cf8a113db1b',aId='8b8a61e2-4b83-4c8c-962e-580b4a594106',bId='e45a599b-1377-4377-9016-3956cc4e0738';
const checks=[],servers=[],streams=[],startedAt=new Date().toISOString();let gateway,child,now=Date.now(),before,requestId=0;
fs.mkdirSync(out,{recursive:true});
const log=fs.openSync(path.join(out,`qa-runtime-${evidenceId}.log`),'a');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function snapshot(name){const p=new Pool({connectionString:db(name,true)}),c=await p.connect(),r={};try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');for(const {tablename:t}of(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){assert(/^[a-z_0-9]+$/.test(t));r[t]=(await c.query(`SELECT COUNT(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${t}" t`)).rows[0];}await c.query('COMMIT');return r;}finally{c.release();await p.end();}}
async function officialSnapshot(){return Object.fromEntries(await Promise.all(['tournament','match','scheduling','discipline','team'].map(async n=>[n,await snapshot('sfl_'+n)])));}
async function check(name,task){await task();checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function http(cookie,url,method='GET',body){const r=await fetch('http://127.0.0.1:19680/api'+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?null:await r.json()};}
async function ok(cookie,url,method='GET',body,status=200){const r=await http(cookie,url,method,body);assert.equal(r.status,status,url+' '+JSON.stringify(r.body));return r.body;}
async function rejected(cookie,url,method,body,code,status=409){const r=await http(cookie,url,method,body);assert.equal(r.status,status,JSON.stringify(r.body));if(code)assert.equal(r.body.error.code,code,JSON.stringify(r.body));return r;}
async function login(email){const password=fs.readFileSync(path.join(root,'docs/DEMO_ACCOUNTS_AND_TESTING.md'),'utf8').match(/Demo@\d{6}/)?.[0];assert(password);const r=await fetch('http://127.0.0.1:19680/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Normal Auth login');const data=await r.json();return {cookie:r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),data};}
async function mount(file,error,port,prefix=''){const app=express(),mod=require(path.join(root,file));app.use(express.json());app.use(prefix,mod.internalRoutes??mod.teamRoutes??mod.tournamentRoutes);app.use(require(path.join(root,error)).errorHandler);servers.push(await new Promise((resolve,reject)=>{const s=app.listen(port,'127.0.0.1',()=>resolve(s));s.on('error',reject);}));}
async function startChild(){child=fork(path.join(root,'scripts/qa-projections-runtime.cjs'),[],{cwd:root,env:{...process.env,PORT:'19605',QA_NOW:String(now)},stdio:['ignore',log,log,'ipc'],windowsHide:true});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('QA host startup timeout')),15000);child.once('exit',code=>{clearTimeout(timer);reject(Error('QA host exited '+code));});child.on('message',m=>{if(m.ready){clearTimeout(timer);resolve();}});});}
async function stopChild(){if(!child||child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.send({op:'close'});});}
async function time(value){now=value;const id=++requestId;await new Promise((resolve,reject)=>{const onMessage=m=>{if(m.id!==id)return;child.off('message',onMessage);m.error?reject(Error(m.error)):resolve();};child.on('message',onMessage);child.send({op:'time',now,id});});}
async function advance(ms){await time(now+ms);}
async function syncOutbox(){const id=++requestId;return new Promise((resolve,reject)=>{const listener=m=>{if(m.id!==id)return;child.off('message',listener);m.error?reject(Error(m.error)):resolve(m.count);};child.on('message',listener);child.send({op:'outbox',id});});}
async function sse(last,cookie,matchId){const abort=new AbortController(),r=await fetch('http://127.0.0.1:19680/api'+(matchId?'/matches/'+matchId+'/stream':'/matches/live/stream'),{signal:abort.signal,headers:{cookie:cookie??'',...(last?{'Last-Event-ID':last}:{})}});assert.equal(r.status,200);const events=[],reader=r.body.getReader();let buffer='';const done=(async()=>{try{while(true){const {value,done}=await reader.read();if(done)return;buffer+=new TextDecoder().decode(value);let index;while((index=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,index);buffer=buffer.slice(index+2);if(frame.includes('event: match-update'))events.push(JSON.parse(frame.match(/data: (.+)/)[1]));}}}catch(e){if(e.name!=='AbortError')throw e;}})();const s={events,close:()=>abort.abort(),done};streams.push(s);return s;}
async function waitFor(predicate){for(let i=0;i<100;i++){if(predicate())return;await sleep(40);}throw Error('Expected asynchronous update not received');}
async function main(){
 before=await officialSnapshot();fs.writeFileSync(path.join(out,`database-before-${evidenceId}.json`),JSON.stringify(before,null,2),{flag:'wx'});
 Object.assign(process.env,env,{NODE_ENV:'test',AUTH_SERVICE_URL:'http://127.0.0.1:19601',ORGANIZATION_SERVICE_URL:'http://127.0.0.1:19604',TOURNAMENT_SERVICE_URL:'http://127.0.0.1:19603',MATCH_SERVICE_URL:'http://127.0.0.1:19605',NOTIFICATION_SERVICE_URL:'http://127.0.0.1:1',DATABASE_URL:db(qa('auth')),ACCOUNT_DATABASE_URL:db(qa('user'))});
 await mount('services/auth-service/dist/account/routes/internalRoutes','services/auth-service/dist/middleware/errorHandler',19601,'/internal');
 process.env.DATABASE_URL=db(qa('team'));await mount('services/organization-service/dist/routes/teamRoutes','services/organization-service/dist/middleware/errorHandler',19604);
 process.env.DATABASE_URL=db(qa('tournament'));await mount('services/tournament-service/dist/routes/tournamentRoutes','services/tournament-service/dist/middleware/errorHandler',19603);
 process.env.DATABASE_URL=db(qa('match'));process.env.SCHEDULING_DATABASE_URL=db(qa('scheduling'));process.env.DISCIPLINE_DATABASE_URL=db(qa('discipline'));
 const migrate=require(path.join(root,'services/match-service/dist/db/migrate')).runMigrations;
 await check('migration 29 is transactional, repeatable and preserves legacy business rows',async()=>{const p=new Pool({connectionString:db(qa('match'))});try{const old=(await p.query('SELECT match_id,phase,elapsed_seconds,total_elapsed_seconds,is_running,version FROM match_clock_states ORDER BY match_id')).rows;await migrate(db(qa('match')));await migrate(db(qa('match')));assert.deepEqual((await p.query('SELECT match_id,phase,elapsed_seconds,total_elapsed_seconds,is_running,version FROM match_clock_states ORDER BY match_id')).rows,old);assert.equal((await p.query('SELECT COUNT(*)::int AS n FROM sfl_schema_migrations WHERE version=29')).rows[0].n,1);}finally{await p.end();}});
 await startChild();gateway=spawn(process.execPath,[path.join(root,'apps/api-gateway/dist/index.js')],{cwd:root,env:{...process.env,PORT:'19680',AUTH_SERVICE_URL:'http://127.0.0.1:3001',CORS_ORIGIN:'http://127.0.0.1:19680,http://localhost:5173'},stdio:['ignore',log,log],windowsHide:true});
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:19680/health')).ok)break;}catch{}await sleep(100);}
 if(process.argv[3]==='browser'){
   console.log('QA browser API ready:19680; real restored PostgreSQL only; no new frontend');
   await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});return;
 }
 const btc=(await login('dataset.btc01@football.local')).cookie,ref=(await login('dataset.captain02@football.local')).cookie,outside=(await login('dataset.captain01@football.local')).cookie;
 const {selectMatchLaw}=require(path.join(root,'packages/shared/dist'));
 async function prepare(matchId,law,format,officialEmail='dataset.captain02@football.local',crewMode=null){
  const m=(await ok(btc,`/matches/${matchId}`)).match,t=m.tournamentId;
  if(m.status==='LINEUP_CONFIRMED')await ok(btc,`/matches/${matchId}/preparation/organizer`,'POST',{action:'REOPEN',reason:'Controlled QA preparation; preserve the original inconsistent match in the official database'});
  const assignmentUrl=`/tournaments/${t}/referee-team/assignments`;
  let assignment=(await ok(btc,assignmentUrl)).matches.find(row=>row.matchId===matchId);assert(assignment,'Actual published schedule is required');
  let team=(await ok(btc,`/tournaments/${t}/referee-team`)).members;
  if(!team.some(p=>p.identity.email===officialEmail)){
   await ok(btc,`/tournaments/${t}/referee-team`,'POST',{email:officialEmail,requestId:randomUUID(),profile:{organization:'Controlled QA clock validation',formats:[format],positions:['REFEREE']}},201);
   team=(await ok(btc,`/tournaments/${t}/referee-team`)).members;
  }
  let support;
  if(crewMode){
   const supportEmail='dataset.captain01@football.local';
   if(!team.some(p=>p.identity.email===supportEmail))await ok(btc,`/tournaments/${t}/referee-team`,'POST',{email:supportEmail,requestId:randomUUID(),profile:{organization:'Controlled QA event crew',formats:[format],positions:['MATCH_SECRETARY']}},201);
   team=(await ok(btc,`/tournaments/${t}/referee-team`)).members;support=team.find(p=>p.identity.email===supportEmail);
   await ok(btc,`/tournaments/${t}/referee-team/${support.id}`,'PATCH',{profile:{...support.profile,formats:[...new Set([...support.profile.formats,format])],positions:[...new Set([...support.profile.positions,'MATCH_SECRETARY'])]}});
  }
  if(!assignment.publication){
   const member=team.find(p=>p.identity.email===officialEmail);assert(member,'Reuse an existing active tournament referee, without creating an account');
   if(!member.profile.positions.includes('REFEREE'))await ok(btc,`/tournaments/${t}/referee-team/${member.id}`,'PATCH',{profile:{...member.profile,positions:[...member.profile.positions,'REFEREE']}});
   const positions=[{code:'REFEREE',label:'Trọng tài chính',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT',...(crewMode==='FINALIZE_ONLY'?[]:['MANAGE_REPORT']),'FINALIZE']},...(crewMode?[{code:'MATCH_SECRETARY',label:'Thư ký trận',required:true,capabilities:crewMode==='READ'?[]:['MANAGE_REPORT']}]:[])];
   const configUrl=`/tournaments/${t}/referee-team/configuration`,configuration=await ok(btc,configUrl);
   if(!configuration.configuration){await ok(btc,configUrl,'PUT',{expectedRevision:configuration.revision,configuration:{defaultPositions:positions,overrides:[]}});assignment=(await ok(btc,assignmentUrl)).matches.find(row=>row.matchId===matchId);}
   await ok(btc,`${assignmentUrl}/${matchId}`,'PUT',{expectedRevision:assignment.revision,configurationRevision:assignment.configurationRevision,scheduleSignature:assignment.scheduleSignature,matchPositions:positions,slots:[{position:'REFEREE',refereeId:member.userId},...(crewMode?[{position:'MATCH_SECRETARY',refereeId:support.userId}]:[])]});
   assignment=(await ok(btc,assignmentUrl)).matches.find(row=>row.matchId===matchId);
   await ok(btc,`${assignmentUrl}/publish`,'POST',{requestId:randomUUID(),matches:[{matchId,expectedRevision:assignment.revision,configurationRevision:assignment.configurationRevision,scheduleSignature:assignment.scheduleSignature}]});
   assignment=(await ok(btc,assignmentUrl)).matches.find(row=>row.matchId===matchId);
  }
  const finalPosition=assignment.positions.find(p=>p.capabilities.includes('FINALIZE')),finalId=assignment.slots.find(s=>s.position===finalPosition?.code)?.refereeId,member=team.find(p=>p.userId===finalId);assert(member,'Published final authority');
  // Preserve authentication: when a copied publication belongs to an account
  // whose password is unavailable, use the real replacement workflow in QA.
  if(member.identity.email!==officialEmail){
   const replacement=team.find(p=>p.identity.email===officialEmail);assert(replacement,'Known QA referee already belongs to this tournament');
   if(!replacement.profile.positions.includes(finalPosition.code))await ok(btc,`/tournaments/${t}/referee-team/${replacement.id}`,'PATCH',{profile:{...replacement.profile,positions:[...replacement.profile.positions,finalPosition.code]}});
   await ok(btc,`${assignmentUrl}/${matchId}/replace`,'POST',{requestId:randomUUID(),expectedPublicationRevision:assignment.publication.revision,scheduleSignature:assignment.scheduleSignature,position:finalPosition.code,oldRefereeId:member.userId,newRefereeId:replacement.userId,reason:'Controlled QA: use an existing authenticated official with a known account; do not bypass authentication'});
  }
  const official=officialEmail==='dataset.captain02@football.local'?ref:officialEmail==='dataset.captain01@football.local'?outside:(await login(officialEmail)).cookie;
  const ruleUrl=`/tournaments/${t}/regulation-operation-rules`,current=await ok(btc,ruleUrl),rules=selectMatchLaw(law);Object.assign(rules.values,{...(law==='IFAB_2026_27'?{substitutionMode:'LIMITED',maxSubstitutions:5,substitutionOpportunities:3,returnSubstitutes:'NO'}:{}),maxSubstitutes:format===11?9:5,shirtNumbers:'UNIQUE_1_99',halfTimeMinutes:10,groupDrawPolicy:'ALLOW_DRAW',headToHeadPolicy:'POINTS',fairPlayPolicy:JSON.stringify({YELLOW:1,SECOND_YELLOW:3,RED:4,YELLOW_RED:5}),disciplineScope:'TOURNAMENT',suspensionStarts:'NEXT_TEAM_MATCH',cardResetPolicy:'CARRY_ALL',directRedSuspensionMatches:2,secondYellowSuspensionMatches:1,secondYellowAccumulation:'EXCLUDE_MATCH',shootoutDiscipline:'RED_ONLY',concurrentSanctions:'SEQUENTIAL'});
  const v=(await ok(btc,ruleUrl,'POST',{baseRegulationVersion:1,expectedRevision:Math.max(0,...current.versions.map(v=>v.revision)),rules,reason:'Explicit Prompt 5 controlled QA clock rules; no original published regulation is altered'},201)).version;
  await ok(btc,`${ruleUrl}/${v.revision}/publish`,'POST',{expectedRevision:v.revision});
  const priorBasis=(await ok(btc,`/matches/${matchId}/operation-rules`)).rules.base;
  await ok(btc,`/tournaments/${t}/fixtures/operation-rules/apply`,'POST',{supplementId:v.id,matches:[{matchId,expectedBindingRevision:0}],...(priorBasis.regulationVersion==null?{confirmLegacyBaseVersion:true}:{}),reason:'Controlled QA organizer explicitly pins the published base and chosen rulebook for this restored fixture only'});
  const org=new Pool({connectionString:db(qa('team'))}),auth=new Pool({connectionString:db('sfl_user',true)});let entries=[];
  try{for(const teamId of [m.homeTeamId,m.awayTeamId]){const captain=(await org.query('SELECT captain_id FROM teams WHERE id=$1',[teamId])).rows[0],email=(await auth.query('SELECT email FROM users WHERE id=$1',[captain.captain_id])).rows[0].email,who=(await login(email)).cookie,url=`/matches/${matchId}/squads/${teamId}`,w=await ok(who,url),people=w.roster.players.filter(p=>p.eligible),keeper=people.find(p=>p.position==='GK');assert(keeper,'Actual roster goalkeeper');const list=[keeper,...people.filter(p=>p.id!==keeper.id).slice(0,format+2)].map((p,i)=>({playerId:p.id,jerseyNumber:i+1,position:i?'MF':'GK',isStarting:i<format}));await ok(who,url,'PUT',{entries:list,expectedRevision:w.squad.revision,submit:true});const saved=await ok(who,url);await ok(official,url+'/review','POST',{action:'APPROVE',expectedRevision:saved.squad.revision});entries.push(list);}}finally{await org.end();await auth.end();}
  await ok(official,`/matches/${matchId}/referee-status`,'PUT',{status:'LINEUP_CONFIRMED'});return {m,entries,official,context:await ok(official,`/matches/${matchId}/referee-context`)};
 }
 const mp=new Pool({connectionString:db(qa('match'))});
 try{
 await require('./qa-match-projections-cases.cjs')({assert,randomUUID,check,http,ok,rejected,login,prepare,mp,Pool,db,qa,btc,ref,outside,aId,bId,tourId,time,advance,sse,waitFor,sleep,syncOutbox,stopChild,startChild,officialSnapshot,before,out,runId});
 }finally{await mp.end();}
}main().catch(error=>{checks.push({name:'QA execution',status:'FAIL',reason:error.message});console.error(error.stack);process.exitCode=1;}).finally(async()=>{
 for(const s of streams)s.close();await Promise.allSettled(streams.map(s=>s.done));await stopChild();gateway?.kill();for(const s of servers)s.closeAllConnections?.();await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));
 for(const name of ['services/tournament-service/dist/lib/db','services/auth-service/dist/account/lib/db','services/organization-service/dist/lib/db']){const mod=require.cache[require.resolve(path.join(root,name))];if(mod?.exports.closePool)await mod.exports.closePool();}
 if(before){try{assert.deepEqual(await officialSnapshot(),before);}catch(e){checks.push({name:'Original database preservation on exit',status:'FAIL',reason:e.message});process.exitCode=1;}}
 fs.writeFileSync(path.join(out,`qa-api-${evidenceId}.json`),JSON.stringify({startedAt,finishedAt:new Date().toISOString(),checks},null,2),{flag:'wx'});
});



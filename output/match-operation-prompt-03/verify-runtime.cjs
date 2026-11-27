// Read-only official release checks. Session cookies and local credentials are never recorded.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),base='http://localhost:5173';
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const password=fs.readFileSync(path.join(root,'docs/DEMO_ACCOUNTS_AND_TESTING.md'),'utf8').match(/Demo@\d{6}/)?.[0];assert(password);
const tourId='9f765a91-b8ab-4716-a083-0cf8a113db1b',aId='8b8a61e2-4b83-4c8c-962e-580b4a594106';
async function login(email){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Normal Auth login');return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
async function get(cookie,url){const r=await fetch(base+'/api'+url,{headers:{cookie}});assert.equal(r.status,200,url);return r.json();}
async function database(name,prior){
 const p=new Pool({host:'127.0.0.1',port:Number(env.POSTGRES_PORT||5432),user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database:'sfl_'+name}),c=await p.connect();
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const comparison=[];
  for(const [t,old]of Object.entries(prior)){assert(/^[a-z_0-9]+$/.test(t));const now=(await c.query(`SELECT COUNT(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${t}" t`)).rows[0];comparison.push({table:t,rowsBefore:old.rows,rowsAfter:now.rows,unchanged:JSON.stringify(old)===JSON.stringify(now)});}
  const extra=name==='match'?(await c.query("SELECT to_regclass('public.schedules') AS schedules,to_regclass('public.schedule_referee_assignments') AS assignments")).rows[0]:null;
  if(extra){assert.equal(extra.schedules,null);assert.equal(extra.assignments,null);}
  await c.query('COMMIT');return {allOriginalTablesUnchanged:comparison.every(t=>t.unchanged),comparison,matchDoesNotOwnSchedulingTables:extra?extra.schedules===null&&extra.assignments===null:undefined};
 }finally{c.release();await p.end();}
}
async function main(){
 const cookie=await login('dataset.btc01@football.local'),tournaments=[];
 for(const [format,id,total]of [['ROUND_ROBIN','248006af-5af3-4ff5-8486-47b80fc269b9',12],['KNOCKOUT','d9fe5a04-5e71-41ec-b85c-f4567b294c68',15],['HYBRID',tourId,31]]){
  const r=(await get(cookie,`/tournaments/${id}/fixtures/operation-readiness`)).readiness;
  assert.equal(r.stats.total,total);assert.equal(r.stats.ready,r.matches.filter(m=>m.canPrepare&&m.matchStatus!=='IN_PROGRESS').length);
  assert.equal(r.allAssignmentsPublished,r.matches.length>0&&r.matches.every(m=>m.fixturePublished&&m.schedulePublished&&m.crewPublished));
  if(id===tourId){assert(r.stats.published>0&&r.stats.published<total);assert.equal(r.allAssignmentsPublished,false);assert.equal(r.canOpenOperations,true);}
  tournaments.push({format,tournamentId:id,stats:r.stats,allAssignmentsPublished:r.allAssignmentsPublished,canOpenOperations:r.canOpenOperations,status:'PASS'});
 }
 const referee=await login('dataset.captain02@football.local'),workspace=await get(referee,'/my/schedules/workspace');assert(workspace.items.some(m=>m.match.id===aId));
 const context=await get(referee,`/matches/${aId}/referee-context`),r=(await get(referee,`/matches/${aId}/operation-readiness`)).readiness;
 assert.deepEqual(context.readiness,r);assert.equal(r.matchStatus,'SCHEDULED');assert.equal(r.canPrepare,true);assert.equal(r.canStart,false);assert.equal(r.kickoffReached,false);
 const clock=(await get(referee,`/matches/${aId}/clock`)).clock;assert.equal(clock.phase,'NOT_STARTED');assert.equal(clock.version,0);
 const legacyReady=(await get(cookie,'/matches/e45a599b-1377-4377-9016-3956cc4e0738/operation-readiness')).readiness;
 assert.equal(legacyReady.matchStatus,'LINEUP_CONFIRMED');assert.equal(legacyReady.lineupsConfirmed,false);assert.equal(legacyReady.canStart,false);
 const html=await(await fetch(base+'/referee')).text(),script=html.match(/src="(\/assets\/index-[^"]+\.js)"/);assert(script,'Production JS entry');
 const bytes=Buffer.from(await(await fetch(base+script[1])).arrayBuffer()),local=fs.readFileSync(path.join(root,'apps/web-client/dist',script[1]));
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(sha(bytes),sha(local));
 const proof={createdAt:new Date().toISOString(),baseUrl:base,tournaments,referee:{matchId:aId,contextMatchesReadinessApi:true,canPrepare:r.canPrepare,canStart:r.canStart,kickoffReached:r.kickoffReached,clockPhase:clock.phase,clockVersion:clock.version},legacyReadyMatch:{matchId:legacyReady.matchId,hasConfirmedLineups:false,canStart:false},asset:script[1],assetSha256:sha(bytes),localBuildMatchesRuntime:true};
 fs.writeFileSync(path.join(__dirname,'runtime-api-proof.json'),JSON.stringify(proof,null,2));
 const before=JSON.parse(fs.readFileSync(path.join(__dirname,'database-before.json'),'utf8')),databases={};for(const name of ['tournament','match','scheduling','discipline'])databases[name]=await database(name,before[name]);
 fs.writeFileSync(path.join(__dirname,'official-database-proof.json'),JSON.stringify({createdAt:new Date().toISOString(),databases},null,2));
 assert(Object.values(databases).every(d=>d.allOriginalTablesUnchanged),'Official domain tables must remain unchanged');
 console.log(JSON.stringify({tournaments,referee:proof.referee,localBuildMatchesRuntime:true,allOriginalDomainTablesUnchanged:true}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

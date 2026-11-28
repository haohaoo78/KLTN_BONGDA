// Controlled integration harness. Uses normal Auth sessions and the real Gateway.
// All rule/draft/binding writes go to two explicitly named QA databases only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/match-operation-prompt-02');
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const express=require(path.join(root,'services/tournament-service/node_modules/express'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
function db(name){assert(/^sfl_(prompt02_qa_|tournament$|match$|scheduling$)/.test(name));return `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/${name}`;}
const runId=process.argv[2]||'001';assert(/^\d{3}$/.test(runId));
const tourDb=`sfl_prompt02_qa_tournament_20261126_${runId}`,matchDb=`sfl_prompt02_qa_match_20261126_${runId}`;
const ids={hybrid:'9f765a91-b8ab-4716-a083-0cf8a113db1b',knockout:'d9fe5a04-5e71-41ec-b85c-f4567b294c68',rr:'248006af-5af3-4ff5-8486-47b80fc269b9'};
const checks=[],servers=[];let gateway;
const qaLog=fs.openSync(path.join(out,'qa-gateway.log'),'a');
async function snapshot(name){const pool=new Pool({connectionString:db(name)});const client=await pool.connect();try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result={};
  const tables=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  for(const {tablename}of tables.rows){if(['sfl_schema_migrations','regulation_operation_rules','match_operation_rule_bindings'].includes(tablename))continue;assert(/^[a-z_0-9]+$/.test(tablename));result[tablename]=(await client.query(`SELECT COUNT(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${tablename}" t`)).rows[0];}
  await client.query('COMMIT');return result;
}finally{client.release();await pool.end();}}
async function http(cookie,url,method='GET',body){const r=await fetch('http://127.0.0.1:19080/api'+url,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:r.status===204?null:await r.json()};}
async function login(email){const files=['DEMO_ACCOUNTS_AND_TESTING.md','DEMO_TEST_ACCOUNTS.md','DEMO_ACCOUNT_CREDENTIALS.csv'];let password;for(const f of files){const m=fs.readFileSync(path.join(root,'docs',f),'utf8').match(/Demo@\d{6}/);if(m){password=m[0];break;}}assert(password,'No documented QA credential available');const r=await fetch('http://127.0.0.1:19080/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Normal Auth login failed');const cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert(cookie);return cookie;}
async function check(name,run){await run();checks.push({name,status:'PASS'});console.log('PASS '+name);}
async function listen(app,port){servers.push(await new Promise((resolve,reject)=>{const server=app.listen(port,'127.0.0.1',()=>resolve(server));server.on('error',reject);}));}
async function main(){
  const before={tournament:await snapshot('sfl_tournament'),match:await snapshot('sfl_match')};fs.writeFileSync(path.join(out,'database-before.json'),JSON.stringify(before,null,2));
  Object.assign(process.env,{INTERNAL_API_KEY:env.INTERNAL_API_KEY,DATABASE_URL:db(tourDb),NODE_ENV:'test',MATCH_SERVICE_URL:'http://127.0.0.1:19204',TOURNAMENT_SERVICE_URL:'http://127.0.0.1:19203',AUTH_SERVICE_URL:'http://127.0.0.1:3001',ORGANIZATION_SERVICE_URL:'http://127.0.0.1:3004',NOTIFICATION_SERVICE_URL:'http://127.0.0.1:3006'});
  await require('../services/tournament-service/dist/db/migrate').runMigrations();
  const tourApp=express();tourApp.use(express.json());tourApp.use(require('../services/tournament-service/dist/routes/tournamentRoutes').tournamentRoutes);tourApp.use(require('../services/tournament-service/dist/middleware/errorHandler').errorHandler);await listen(tourApp,19203);
  process.env.DATABASE_URL=db(matchDb);const schedulingReadOnly=new URL(db('sfl_scheduling'));schedulingReadOnly.searchParams.set('options','-c default_transaction_read_only=on');process.env.SCHEDULING_DATABASE_URL=schedulingReadOnly.toString();process.env.DISCIPLINE_DATABASE_URL=db(matchDb);
  await require('../services/match-service/dist/db/matchOperationRulesMigration').applyMatchOperationRulesMigration(db(matchDb));
  const matchApp=express();matchApp.use(express.json());matchApp.use(require('../services/match-service/dist/routes/matchRoutes').matchRoutes);matchApp.use(require('../services/match-service/dist/middleware/errorHandler').errorHandler);await listen(matchApp,19204);
  gateway=spawn(process.execPath,[path.join(root,'apps/api-gateway/dist/index.js')],{cwd:root,env:{...process.env,PORT:'19080',CORS_ORIGIN:'http://127.0.0.1:19080'},stdio:['ignore',qaLog,qaLog],windowsHide:true});
  for(let i=0;i<40;i++){try{if((await fetch('http://127.0.0.1:19080/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,150));}
  const btc=await login('dataset.btc01@football.local'),ref=await login('dataset.captain01@football.local');
  if(process.argv.includes('--verify-legacy')){
    const url=`/tournaments/${ids.rr}/regulation-operation-rules`,c=await http(btc,`/tournaments/${ids.rr}/fixtures/operation-rules`);assert.equal(c.status,200);
    const candidate=c.body.matches.find(m=>m.eligible&&m.needsBaseVersionConfirmation);assert(candidate);
    await check('legacy read reports the missing historical basis without crashing or using current rules',async()=>{const r=await http(btc,`/matches/${candidate.matchId}/operation-rules`);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.rules.base.regulationVersion,null);assert.equal(r.body.rules.base.source,'MISSING_DRAW_SNAPSHOT');assert.equal(r.body.rules.base.rules,null);});
    // Explicit QA selection only. This does not reclassify the real IUH tournament.
    const rules=require('../packages/shared/dist').selectMatchLaw('FIFA_FUTSAL_2026_27');Object.assign(rules.values,{halfTimeMinutes:10,maxSubstitutes:5,shirtNumbers:'UNIQUE_1_99',groupDrawPolicy:'ALLOW_DRAW'});
    let version;
    await check('new supplement captures a real base regulation without editing that regulation',async()=>{const r=await http(btc,url,'POST',{baseRegulationVersion:1,expectedRevision:0,rules,reason:'Explicit isolated QA choice to verify legacy basis confirmation; not an official sport conversion'});assert.equal(r.status,201,JSON.stringify(r.body));version=r.body.version;assert.equal(version.baseSnapshot.regulationVersion,1);assert.equal(version.baseSnapshot.rules.matchDurationMinutes,40);const p=await http(btc,`${url}/${version.revision}/publish`,'POST',{expectedRevision:version.revision});assert.equal(p.status,200);});
    const applyUrl=`/tournaments/${ids.rr}/fixtures/operation-rules/apply`,payload={supplementId:version.id,matches:[{matchId:candidate.matchId,expectedBindingRevision:0}],reason:'QA organizer explicitly establishes basis for one unused legacy match'};
    await check('legacy basis is never inferred without organizer confirmation',async()=>{const r=await http(btc,applyUrl,'POST',payload);assert.equal(r.status,409);assert.equal(r.body.error.code,'MATCH_RULES_BASE_CONFIRMATION_REQUIRED');});
    await check('explicit confirmation pins the audited supplement basis in PostgreSQL',async()=>{const r=await http(btc,applyUrl,'POST',{...payload,confirmLegacyBaseVersion:true});assert.equal(r.status,200,JSON.stringify(r.body));const saved=await http(btc,`/matches/${candidate.matchId}/operation-rules`);assert.equal(saved.body.rules.base.source,'VERSIONED_SUPPLEMENT_BASE');assert.equal(saved.body.rules.base.regulationVersion,1);assert.equal(saved.body.rules.supplement.id,version.id);assert.equal(saved.body.rules.rules.values.periodMinutes,20);});
    await check('a published legacy supplement does not silently govern other matches',async()=>{const other=c.body.matches.find(m=>m.matchId!==candidate.matchId),r=await http(btc,`/matches/${other.matchId}/operation-rules`);assert.equal(r.status,200);assert.equal(r.body.rules.base.regulationVersion,null);assert.equal(r.body.rules.supplement,null);});
    const p=new Pool({connectionString:db(tourDb)}),m=new Pool({connectionString:db(matchDb)});
    try{
      await check('legacy draw and fixture metadata are preserved, not backfilled',async()=>{const d=await p.query("SELECT config->'fixtureRegulationSnapshot' AS snapshot FROM tournament_draw_versions WHERE id=$1",[candidate.drawVersionId]);assert.equal(d.rows[0].snapshot,null);const g=await m.query('SELECT regulation_version FROM match_fixture_generations WHERE draw_version_id=$1',[candidate.drawVersionId]);assert.ok(g.rows.every(r=>r.regulation_version==null));});
      await check('published captured basis is protected from direct database edits',async()=>assert.rejects(p.query("UPDATE regulation_operation_rules SET base_snapshot='{}'::jsonb WHERE id=$1",[version.id]),/immutable/));
    }finally{await p.end();await m.end();}
    await check('legacy QA leaves official business data unchanged',async()=>assert.deepEqual({tournament:await snapshot('sfl_tournament'),match:await snapshot('sfl_match')},before));
    fs.writeFileSync(path.join(out,'qa-legacy-source-checks.json'),JSON.stringify({createdAt:new Date().toISOString(),databases:{tournament:tourDb,match:matchDb},checks},null,2));return;
  }
  if(process.argv.includes('--verify-existing')){
    const versions=await http(btc,`/tournaments/${ids.hybrid}/regulation-operation-rules`),published=versions.body.versions.find(v=>v.status==='PUBLISHED');assert(published);
    const list=await http(btc,`/tournaments/${ids.hybrid}/fixtures/operation-rules`);assert.equal(list.status,200);
    const candidate=list.body.matches.find(m=>m.eligible&&m.stage==='GROUP'&&!m.supplementId);assert(candidate);
    const payload={supplementId:published.id,matches:[{matchId:candidate.matchId,expectedBindingRevision:0}],reason:'Final compiled source QA: published fixture guard and immutable rule source'};
    await check('final source applies rules to a published, unused QA fixture',async()=>{const r=await http(btc,`/tournaments/${ids.hybrid}/fixtures/operation-rules/apply`,'POST',payload);assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.appliedMatchIds,[candidate.matchId]);});
    await check('final source returns identical rule version on repeat reads',async()=>{const a=await http(btc,`/matches/${candidate.matchId}/operation-rules`),b=await http(btc,`/matches/${candidate.matchId}/operation-rules`);assert.equal(a.status,200);assert.deepEqual(a.body,b.body);assert.equal(a.body.rules.supplement.id,published.id);assert.equal(a.body.rules.rules.values.periodMinutes,45);});
    await check('same-version explicit application adds no duplicate binding',async()=>{const r=await http(btc,`/tournaments/${ids.hybrid}/fixtures/operation-rules/apply`,'POST',{...payload,matches:[{matchId:candidate.matchId,expectedBindingRevision:1}]});assert.equal(r.status,200);assert.equal(r.body.appliedMatchIds.length,0);assert.equal(r.body.unchangedCount,1);});
    await check('final source QA leaves original databases unchanged',async()=>{assert.deepEqual({tournament:await snapshot('sfl_tournament'),match:await snapshot('sfl_match')},before);});
    fs.writeFileSync(path.join(out,'qa-final-source-checks.json'),JSON.stringify({createdAt:new Date().toISOString(),databases:{tournament:tourDb,match:matchDb},checks},null,2));return;
  }
  const {selectMatchLaw}=require('../packages/shared/dist');
  const hybridRules=selectMatchLaw('IFAB_2026_27');Object.assign(hybridRules.values,{maxSubstitutes:9,shirtNumbers:'UNIQUE_1_99',halfTimeMinutes:10,substitutionMode:'LIMITED',maxSubstitutions:5,substitutionOpportunities:3,returnSubstitutes:'NO',groupDrawPolicy:'ALLOW_DRAW'});
  const url=`/tournaments/${ids.hybrid}/regulation-operation-rules`;
  const draftBody={baseRegulationVersion:1,expectedRevision:0,rules:hybridRules,reason:'Controlled QA version test; original regulations unchanged'};
  await check('anonymous writes rejected by actual Gateway and service',async()=>assert.equal((await http('',url,'POST',draftBody)).status,401));
  await check('non BTC cannot save rule versions',async()=>assert.equal((await http(ref,url,'POST',draftBody)).status,403));
  let draft,published;
  await check('save draft through API and read again from PostgreSQL',async()=>{const r=await http(btc,url,'POST',draftBody);assert.equal(r.status,201,JSON.stringify(r.body));draft=r.body.version;const read=await http(btc,url);assert.equal(read.body.versions[0].id,draft.id);});
  await check('draft is not disclosed as a published regulation',async()=>{const r=await http('',url);assert.equal(r.status,200);assert.equal(r.body.versions.length,0);});
  await check('stale concurrent save rejected',async()=>assert.equal((await http(btc,url,'POST',draftBody)).status,409));
  await check('publish audited supplement without replacing base regulation',async()=>{const r=await http(btc,`${url}/${draft.revision}/publish`,'POST',{expectedRevision:draft.revision});assert.equal(r.status,200,JSON.stringify(r.body));published=r.body.version;assert.equal(published.status,'PUBLISHED');assert.ok(published.publishedBy);assert.ok(published.publishedAt);});
  await check('republication is idempotent',async()=>{const r=await http(btc,`${url}/${draft.revision}/publish`,'POST',{expectedRevision:draft.revision});assert.equal(r.body.version.publishedAt,published.publishedAt);});
  const candidateResponse=await http(btc,`/tournaments/${ids.hybrid}/fixtures/operation-rules`);assert.equal(candidateResponse.status,200,JSON.stringify(candidateResponse.body));
  const candidate=candidateResponse.body.matches.find(m=>m.eligible&&m.stage==='GROUP');assert(candidate);
  const applyUrl=`/tournaments/${ids.hybrid}/fixtures/operation-rules/apply`,applyBody={supplementId:published.id,matches:[{matchId:candidate.matchId,expectedBindingRevision:0}],reason:'Apply exact published QA supplement to one unused QA fixture'};
  await check('published rules are explicitly pinned to a single eligible QA match',async()=>{const r=await http(btc,applyUrl,'POST',applyBody);assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.appliedMatchIds,[candidate.matchId]);});
  await check('reload reads identical base, supplement and resolved rules',async()=>{const a=await http(btc,`/matches/${candidate.matchId}/operation-rules`),b=await http(btc,`/matches/${candidate.matchId}/operation-rules`);assert.equal(a.status,200,JSON.stringify(a.body));assert.deepEqual(a.body,b.body);assert.equal(a.body.rules.supplement.id,published.id);assert.equal(a.body.rules.base.regulationVersion,1);assert.equal(a.body.rules.rules.values.periodMinutes,45);assert.equal(a.body.rules.decisionMethod,'ALLOW_DRAW');});
  await check('stale match binding cannot overwrite a newer binding',async()=>assert.equal((await http(btc,applyUrl,'POST',applyBody)).status,409));
  await check('a referee without the match cannot read pinned rules',async()=>assert.equal((await http(ref,`/matches/${candidate.matchId}/operation-rules`)).status,403));
  await check('new draft does not change a match pinned to a published version',async()=>{const r=await http(btc,url,'POST',{...draftBody,expectedRevision:1,reason:'Second QA revision remains draft'});assert.equal(r.status,201);const current=await http(btc,`/matches/${candidate.matchId}/operation-rules`);assert.equal(current.body.rules.supplement.id,published.id);});
  await check('unconfigured match reports missing rules without inventing defaults',async()=>{const other=candidateResponse.body.matches.find(m=>m.matchId!==candidate.matchId);const r=await http(btc,`/matches/${other.matchId}/operation-rules`);assert.equal(r.status,200);assert.equal(r.body.rules.rules.lawCode,null);assert.ok(r.body.rules.missing.CLOCK.length);});
  await check('a ready/operated match cannot receive an ordinary rule replacement',async()=>{const m=candidateResponse.body.matches.find(m=>!m.eligible);assert(m);assert.equal((await http(btc,applyUrl,'POST',{...applyBody,matches:[{matchId:m.matchId,expectedBindingRevision:0}]})).status,409);});
  await check('format mismatch and mandatory law edits are rejected by backend',async()=>{const invalid=selectMatchLaw('VFF_7_433_2023');invalid.values.minimumPlayers=3;const r=await http(btc,url,'POST',{...draftBody,expectedRevision:2,rules:invalid});assert.equal(r.status,400);});
  const qaTour=new Pool({connectionString:db(tourDb)}),qaMatch=new Pool({connectionString:db(matchDb)});
  await check('PostgreSQL protects published supplements from UPDATE',async()=>{await assert.rejects(qaTour.query("UPDATE regulation_operation_rules SET reason='overwrite' WHERE id=$1",[published.id]),/immutable/);});
  await check('PostgreSQL protects pinned history from UPDATE',async()=>{await assert.rejects(qaMatch.query("UPDATE match_operation_rule_bindings SET reason='overwrite' WHERE match_id=$1",[candidate.matchId]),/append-only/);});
  await check('QA base rules, fixtures, schedules and roster links remain intact',async()=>{const clone={tournament:await snapshot(tourDb),match:await snapshot(matchDb)};const original={...before.match};delete original.match_realtime_events;delete clone.match.match_realtime_events;assert.deepEqual(clone.tournament,before.tournament);assert.deepEqual(clone.match,original);});
  await qaTour.end();await qaMatch.end();
  const after={tournament:await snapshot('sfl_tournament'),match:await snapshot('sfl_match')};fs.writeFileSync(path.join(out,'database-after-qa.json'),JSON.stringify(after,null,2));
  await check('official Tournament and Match tables unchanged by QA',async()=>assert.deepEqual(after,before));
  fs.writeFileSync(path.join(out,'qa-api-checks.json'),JSON.stringify({createdAt:new Date().toISOString(),databases:{tournament:tourDb,match:matchDb},matchId:candidate.matchId,supplementId:published.id,checks},null,2));
}
main().catch(e=>{checks.push({name:'Harness execution',status:'FAIL',reason:e.message});fs.writeFileSync(path.join(out,'qa-api-checks.json'),JSON.stringify({checks},null,2));console.error(e);process.exitCode=1;}).finally(async()=>{
  gateway?.kill();for(const server of servers)server.closeAllConnections?.();await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));
  for(const p of ['services/tournament-service/dist/lib/db','services/match-service/dist/lib/db','services/match-service/dist/scheduling/lib/db','services/match-service/dist/discipline/lib/db']){const m=require.cache[require.resolve('../'+p)];if(m?.exports.closePool)await m.exports.closePool();}
  fs.closeSync(qaLog);
});

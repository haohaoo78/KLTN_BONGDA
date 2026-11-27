// Read-only release checks; normal Auth login is the only non-GET request.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),base='http://localhost:5173';
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const password=fs.readFileSync(path.join(root,'docs/DEMO_ACCOUNTS_AND_TESTING.md'),'utf8').match(/Demo@\d{6}/)?.[0];assert(password);
const tourId='9f765a91-b8ab-4716-a083-0cf8a113db1b',aId='8b8a61e2-4b83-4c8c-962e-580b4a594106',bId='e45a599b-1377-4377-9016-3956cc4e0738';
const pool=name=>new Pool({host:'127.0.0.1',port:Number(env.POSTGRES_PORT||5432),user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database:'sfl_'+name,options:'-c default_transaction_read_only=on'});
async function login(email){const r=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,'Normal Auth login');return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
async function get(cookie,url){const r=await fetch(base+'/api'+url,{headers:{cookie}});assert.equal(r.status,200,url);return r.json();}
async function database(name,prior){
 const p=pool(name),c=await p.connect();
 try{await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const comparison=[];
  for(const [t,old]of Object.entries(prior)){assert(/^[a-z_0-9]+$/.test(t));const now=(await c.query(`SELECT COUNT(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${t}" t`)).rows[0];comparison.push({table:t,rowsBefore:old.rows,rowsAfter:now.rows,unchanged:JSON.stringify(old)===JSON.stringify(now),expectedSchemaLedgerChange:name==='match'&&t==='sfl_schema_migrations'});}
  let migration=null,newTables=[];
  if(name==='match'){
   migration=(await c.query('SELECT version,name FROM sfl_schema_migrations WHERE version=23')).rows[0];assert(migration,'Migration 23 is present');
   for(const t of ['match_squads','match_squad_history','match_preparation_issues'])newTables.push({table:t,rows:(await c.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n});
   const extra=(await c.query("SELECT to_regclass('public.schedules') AS schedules,to_regclass('public.schedule_referee_assignments') AS assignments")).rows[0];assert.equal(extra.schedules,null);assert.equal(extra.assignments,null);
  }
  await c.query('COMMIT');return {allOriginalBusinessTablesUnchanged:comparison.filter(t=>!t.expectedSchemaLedgerChange).every(t=>t.unchanged),comparison,migration,newTables};
 }finally{c.release();await p.end();}
}
async function main(){
 const btc=await login('dataset.btc01@football.local'),referee=await login('dataset.captain02@football.local');
 const context=await get(referee,`/matches/${aId}/referee-context`),r=(await get(referee,`/matches/${aId}/operation-readiness`)).readiness;
 assert.deepEqual(context.readiness,r);assert.equal(r.matchStatus,'SCHEDULED');assert.equal(r.canPrepare,true);assert.equal(r.canStart,false);
 assert.equal(context.preparation.squads.length,2);assert.equal(context.preparation.ready,false);assert(context.preparation.squads.every(s=>s.entries.length===0));
 const clock=(await get(referee,`/matches/${aId}/clock`)).clock;assert.equal(clock.phase,'NOT_STARTED');assert.equal(clock.version,0);
 const match=(await get(btc,`/matches/${aId}`)).match;
 const org=pool('team'),auth=pool('user');let team,captainEmail;
 try{team=(await org.query('SELECT id,captain_id FROM teams WHERE id=$1',[match.homeTeamId])).rows[0];captainEmail=(await auth.query('SELECT email FROM users WHERE id=$1',[team.captain_id])).rows[0].email;}finally{await org.end();await auth.end();}
 const captain=await login(captainEmail),squad=await get(captain,`/matches/${aId}/squads/${team.id}`);
 assert.equal(squad.roster.registrationStatus,'APPROVED');assert.equal(squad.squad.revision,0);assert.equal(squad.squad.entries.length,0);assert(squad.roster.players.filter(p=>p.eligible).length>=11);assert(squad.rules.missing.LINEUP.length>0);
 const legacy=(await get(btc,`/matches/${bId}/preparation`)).preparation;assert.equal(legacy.inconsistent,true);assert(legacy.squads.every(s=>s.entries.length===0));
 const legacyMatch=(await get(btc,`/matches/${bId}`)).match;assert.equal(legacyMatch.status,'LINEUP_CONFIRMED');
 const tournaments=[];for(const [format,id,total]of [['ROUND_ROBIN','248006af-5af3-4ff5-8486-47b80fc269b9',12],['KNOCKOUT','d9fe5a04-5e71-41ec-b85c-f4567b294c68',15],['HYBRID',tourId,31]]){const v=(await get(btc,`/tournaments/${id}/fixtures/operation-readiness`)).readiness;assert.equal(v.stats.total,total);tournaments.push({format,tournamentId:id,stats:v.stats});}
 const html=await(await fetch(base+'/referee')).text(),script=html.match(/src="(\/assets\/index-[^"]+\.js)"/);assert(script,'Production JS entry');
 const bytes=Buffer.from(await(await fetch(base+script[1])).arrayBuffer()),local=fs.readFileSync(path.join(root,'apps/web-client/dist',script[1]));
 const sha=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(sha(bytes),sha(local));
 const proof={createdAt:new Date().toISOString(),baseUrl:base,tournaments,referee:{matchId:aId,contextMatchesReadinessApi:true,canPrepare:r.canPrepare,canStart:r.canStart,preparationReady:false,lineupCounts:context.preparation.squads.map(s=>s.entries.length),clockPhase:clock.phase,clockVersion:clock.version},captain:{email:captainEmail,teamId:team.id,officialRosterPlayers:squad.roster.players.length,eligibleRosterPlayers:squad.roster.players.filter(p=>p.eligible).length,revision:squad.squad.revision,missingRules:squad.rules.missing.LINEUP},legacyReadyMatch:{matchId:bId,statusPreserved:legacyMatch.status,inconsistent:legacy.inconsistent,lineupCounts:legacy.squads.map(s=>s.entries.length)},asset:script[1],assetSha256:sha(bytes),localBuildMatchesRuntime:true};
 fs.writeFileSync(path.join(__dirname,'runtime-api-proof.json'),JSON.stringify(proof,null,2)+'\n');
 const before=JSON.parse(fs.readFileSync(path.join(__dirname,'database-before-003.json'),'utf8')),databases={};for(const name of ['tournament','match','scheduling','discipline','team'])databases[name]=await database(name,before[name]);
 fs.writeFileSync(path.join(__dirname,'official-database-proof.json'),JSON.stringify({createdAt:new Date().toISOString(),databases},null,2)+'\n');
 // Organization's existing startup reconciliation refreshes two Tournament timestamp columns.
 // Check their complete business rows separately instead of declaring whole-table hashes unchanged.
 const allowedTimestampTables=new Set(['tournament_player_participation_claims','tournament_registration_reservations','tournament_workflow_state']);
 const unexpected=Object.entries(databases).flatMap(([name,d])=>d.comparison.filter(t=>!t.unchanged&&!t.expectedSchemaLedgerChange&&!(name==='tournament'&&allowedTimestampTables.has(t.table))).map(t=>({database:name,table:t.table})));
 assert.equal(unexpected.length,0,'Review unexpected official data changes; never restore over them');
 const preservation=JSON.parse(fs.readFileSync(path.join(__dirname,'registration-row-preservation.json'),'utf8'));assert(preservation.tables.every(t=>t.businessContentUnchanged&&t.missingRows===0));
 const workflow=JSON.parse(fs.readFileSync(path.join(__dirname,'workflow-row-comparison.json'),'utf8'));assert.equal(workflow.rowsBefore,workflow.rowsAfter);assert(workflow.changed.every(r=>r.tournamentId===tourId&&r.fields.every(f=>['updated_at','current_step'].includes(f))),'Only the viewed BTC step may change during UI navigation');
 assert(databases.match.newTables.every(t=>t.rows===0),'No official squad or preparation issue was fabricated');
 console.log(JSON.stringify({runtime:proof,allOriginalBusinessContentPreserved:true,tournamentTimestampsRefreshed:true,viewedBtcStepChanged:workflow.changed.length>0,newMigration:databases.match.migration,newTables:databases.match.newTables}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

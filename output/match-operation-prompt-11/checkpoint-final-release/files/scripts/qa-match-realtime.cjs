// Integration probe against isolated P11 clone databases only; never points at official DB names.
const assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),tag=process.argv[2]||'001';assert(/^\d{3}$/.test(tag));
const names=Object.fromEntries(['match','scheduling'].map(n=>[n,`sfl_prompt11_qa_${n}_20261128_${tag}`]));
assert(Object.values(names).every(n=>n.startsWith('sfl_prompt11_qa_')),'QA-only DB names required');
const fs=require('node:fs'),env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const url=(db)=>`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/${db}`;
process.env.DATABASE_URL=url(names.match);process.env.SCHEDULING_DATABASE_URL=url(names.scheduling);
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const migration=require(path.join(root,'services/match-service/dist/db/matchRealtimeOutboxMigration.js'));
const realtime=require(path.join(root,'services/match-service/dist/realtime/matchRealtime.js'));
const express=require(path.join(root,'services/match-service/node_modules/express'));
const matchPool=new Pool({connectionString:url(names.match)}),schedulingPool=new Pool({connectionString:url(names.scheduling)});
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
async function createSseClient(base,route,cursor){const response=await fetch(`${base}${route}${cursor===null?'':`?after=${cursor}`}`);assert.equal(response.status,200);const reader=response.body.getReader();let text='',frames=[];return {response,async frame(event,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){const index=text.indexOf('\n\n');if(index>=0){const raw=text.slice(0,index);text=text.slice(index+2);const item={event:raw.match(/^event: (.+)$/m)?.[1]??'message',id:raw.match(/^id: (.+)$/m)?.[1]??null,data:JSON.parse(raw.match(/^data: (.+)$/m)?.[1]??'{}')};frames.push(item);if(item.event===event)return item;continue;}const next=await Promise.race([reader.read(),wait(Math.max(1,end-Date.now())).then(()=>({timeout:true}))]);if(next.timeout)break;if(next.done)break;text+=new TextDecoder().decode(next.value);}throw Error(`Timed out waiting for SSE event ${event}; received ${frames.map(f=>f.event).join(',')}`);},async close(){try{await reader.cancel();}catch{};}};}
async function commitEvent(matchId,type){const client=await matchPool.connect();try{await client.query('BEGIN');await realtime.publishMatchUpdate(client,matchId,type);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
async function main(){
 const matchUrl=url(names.match),scheduleUrl=url(names.scheduling);
 await migration.applyMatchRealtimeOutboxMigration(matchUrl);await migration.applySchedulingRealtimeOutboxMigration(scheduleUrl);
 const matchVersion=await matchPool.query('SELECT version FROM sfl_schema_migrations WHERE version=31');
 const scheduleVersion=await schedulingPool.query('SELECT version FROM sfl_schema_migrations WHERE version=1015');assert.equal(matchVersion.rowCount,1);assert.equal(scheduleVersion.rowCount,1);
 const fixture=(await matchPool.query('SELECT id FROM matches ORDER BY created_at,id LIMIT 1')).rows[0];assert(fixture,'QA snapshot needs a preserved match fixture');
 const schedule=(await schedulingPool.query('SELECT id FROM schedules ORDER BY created_at,id LIMIT 1')).rows[0];assert(schedule,'QA snapshot needs a preserved schedule');
 let before=Number((await schedulingPool.query('SELECT count(*)::int AS n FROM scheduling_realtime_outbox')).rows[0].n);
 const rollback=await schedulingPool.connect();try{await rollback.query('BEGIN');await rollback.query('UPDATE schedules SET updated_at=updated_at WHERE id=$1',[schedule.id]);await rollback.query('ROLLBACK');}finally{rollback.release();}
 assert.equal(Number((await schedulingPool.query('SELECT count(*)::int AS n FROM scheduling_realtime_outbox')).rows[0].n),before,'rolled-back scheduling change must not enqueue');
 await schedulingPool.query('UPDATE schedules SET updated_at=updated_at WHERE id=$1',[schedule.id]);
 assert.equal(Number((await schedulingPool.query('SELECT count(*)::int AS n FROM scheduling_realtime_outbox')).rows[0].n),before+1,'committed scheduling change must enqueue');
 assert.equal(await realtime.processSchedulingRealtimeOutbox(),1,'outbox worker should project one committed change');
 const sourceId=(await schedulingPool.query('SELECT id::text FROM scheduling_realtime_outbox WHERE match_id=(SELECT match_id FROM schedules WHERE id=$1) ORDER BY id DESC LIMIT 1',[schedule.id])).rows[0].id;
 assert.equal((await matchPool.query("SELECT count(*)::int AS n FROM match_realtime_events WHERE source_system='SCHEDULING' AND source_event_id=$1",[sourceId])).rows[0].n,1);
 await realtime.processSchedulingRealtimeOutbox();assert.equal((await matchPool.query("SELECT count(*)::int AS n FROM match_realtime_events WHERE source_system='SCHEDULING' AND source_event_id=$1",[sourceId])).rows[0].n,1,'retries must be idempotent');
 const app=express();let authorized=true;app.get('/match/:id',async(req,res)=>{await realtime.subscribeToMatch(req.params.id,res,req.get('Last-Event-ID'),typeof req.query.after==='string'?req.query.after:undefined,async()=>authorized);});app.get('/feed',async(req,res)=>{await realtime.subscribeToMatch('*',res,req.get('Last-Event-ID'));});
 const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 let stream=null,feed=null;
 try{
  await realtime.startMatchRealtimeListener();const start=await realtime.getMatchRealtimeCursor();stream=await createSseClient(base,`/match/${fixture.id}`,start);
  await commitEvent(fixture.id,'qa.stream.one');const first=await stream.frame('match-update');assert.equal(first.data.type,'qa.stream.one');
  await commitEvent(fixture.id,'qa.replay.two');await commitEvent(fixture.id,'qa.replay.three');await stream.close();
  stream=await createSseClient(base,`/match/${fixture.id}`,first.id);const replayOne=await stream.frame('match-update'),replayTwo=await stream.frame('match-update');assert(BigInt(replayOne.id)<BigInt(replayTwo.id));assert.deepEqual([replayOne.data.type,replayTwo.data.type],['qa.replay.two','qa.replay.three']);
  await stream.close();stream=await createSseClient(base,`/match/${fixture.id}`,await realtime.getMatchRealtimeCursor());authorized=false;await commitEvent(fixture.id,'qa.revoked');const revoked=await stream.frame('access-revoked');assert.equal(revoked.event,'access-revoked');
  await stream.close();authorized=true;feed=await createSseClient(base,'/feed',await realtime.getMatchRealtimeCursor());await commitEvent(fixture.id,'qa.private-id-check');const publicEvent=await feed.frame('match-update');assert.equal(publicEvent.data.type,'live-feed.changed');assert.equal(publicEvent.data.matchId,'');assert(!JSON.stringify(publicEvent.data).includes(fixture.id),'global feed must not disclose match IDs');
  await feed.close();const beforeLarge=await realtime.getMatchRealtimeCursor();for(let i=0;i<201;i++)await commitEvent(fixture.id,'qa.backlog');stream=await createSseClient(base,`/match/${fixture.id}`,beforeLarge);const gap=await stream.frame('sync-required');assert.equal(gap.data.reason,'replay-limit');
  console.log(JSON.stringify({result:'PASS',databases:names,migrations:{match:31,scheduling:1015},schedulingOutbox:{rollbackSuppressed:true,committedEventProjected:true,retryIdempotent:true},sse:{liveDelivery:true,replayOrdered:true,accessRevocation:true,publicFeedRedacted:true,overflowRequestsSnapshot:true,overflowEvents:201}}));
 }finally{await stream?.close();await feed?.close();await realtime.stopMatchRealtimeListener();await new Promise(resolve=>server.close(resolve));await Promise.all([matchPool.end(),schedulingPool.end()]);}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

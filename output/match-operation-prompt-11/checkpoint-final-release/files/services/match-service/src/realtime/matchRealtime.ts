import type { Response } from "express";
import { Client, type PoolClient } from "pg";
import { config } from "../config";
import { getPool } from "../lib/db";
import { getPool as getSchedulingPool } from "../scheduling/lib/db";

const channel = "sfl_match_realtime";
const replayLimit = 200;
const sequenceLock = "sfl_match_realtime_commit_order";
export type RealtimeReplayDecision={kind:"snapshot"}|{kind:"replay"}|{kind:"sync-required";reason:"cursor-ahead"|"retention-gap"|"replay-limit"};
export function classifyRealtimeReplay(cursor:string|null,high:string,min:string,backlogCount:number,limit=replayLimit):RealtimeReplayDecision{
 if(cursor===null)return {kind:"snapshot"};
 const c=BigInt(cursor),h=BigInt(high),m=BigInt(min);
 if(c>h)return {kind:"sync-required",reason:"cursor-ahead"};
 if(m>0n&&c<m-1n)return {kind:"sync-required",reason:"retention-gap"};
 if(backlogCount>limit)return {kind:"sync-required",reason:"replay-limit"};
 return {kind:"replay"};
}
type RealtimeEnvelope = { id: string; matchId: string; type: string; occurredAt: string };
type Subscriber = { response: Response; replaying: boolean; buffer: RealtimeEnvelope[]; authorize?: () => Promise<boolean>; checking: boolean; lastDeliveredId: bigint };
const subscribers = new Map<string, Set<Subscriber>>();
let listener: Client | null = null;
let stopped = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let replayTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let dispatchingOutbox = false;
let lastObservedId: bigint | null = null;
let everConnected = false;

function writeFrame(res: Response, event: string, data: unknown, id?: string): void {
  if (res.writableEnded || res.destroyed) return;
  if (id && /^\d+$/.test(id)) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function sendMatchUpdate(subscriber: Subscriber, envelope: RealtimeEnvelope): void {
  const visible = subscriber.response.locals.realtimePublicFeed === true
    ? { ...envelope, matchId: "", type: "live-feed.changed" }
    : envelope;
  writeFrame(subscriber.response, "match-update", visible, envelope.id);
}
function matchesSubscriber(key: string, envelope: RealtimeEnvelope): boolean {
  return key === "*" || key === envelope.matchId;
}
function queueEnvelope(subscriber:Subscriber,envelope:RealtimeEnvelope):void{
 if(BigInt(envelope.id)<=subscriber.lastDeliveredId||subscriber.buffer.some(item=>item.id===envelope.id))return;
 subscriber.buffer.push(envelope);
}
async function drainSubscriber(key:string,subscriber:Subscriber):Promise<void>{
 if(subscriber.checking||subscriber.replaying||subscriber.response.writableEnded||subscriber.response.destroyed)return;
 subscriber.checking=true;
 try{
  while(subscriber.buffer.length&&!subscriber.response.writableEnded&&!subscriber.response.destroyed){
   subscriber.buffer.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
   const envelope=subscriber.buffer.shift()!;
   if(BigInt(envelope.id)<=subscriber.lastDeliveredId)continue;
   if(subscriber.authorize){
    let allowed=false;try{allowed=await subscriber.authorize();}catch{allowed=false;}
    if(!allowed){writeFrame(subscriber.response,"access-revoked",{},envelope.id);subscriber.response.end();return;}
   }
   sendMatchUpdate(subscriber,envelope);subscriber.lastDeliveredId=BigInt(envelope.id);
  }
 }finally{subscriber.checking=false;}
}
function deliver(envelope: RealtimeEnvelope): void {
  for (const [key, entries] of subscribers) for (const entry of entries) {
    if (!matchesSubscriber(key, envelope) || entry.response.writableEnded || entry.response.destroyed) continue;
    queueEnvelope(entry,envelope);
    if(!entry.replaying)void drainSubscriber(key,entry);
  }
}

/** Called inside the owner transaction: the advisory lock makes event IDs follow commit order. */
export async function publishMatchUpdate(client: PoolClient, matchId: string, type: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",[sequenceLock]);
  const saved = await client.query<{ id: string; occurred_at: Date }>(
    `INSERT INTO match_realtime_events (match_id, event_type) VALUES ($1, $2) RETURNING id, occurred_at`, [matchId, type],
  );
  const envelope: RealtimeEnvelope = { id:saved.rows[0].id,matchId,type,occurredAt:saved.rows[0].occurred_at.toISOString() };
  await client.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(envelope)]);
}

/**
 * Scheduling is a separate database. Its trigger writes a transactional outbox row;
 * this worker projects it into the Match event log with a durable source receipt.
 */
export async function processSchedulingRealtimeOutbox(limit=100):Promise<number>{
 if(dispatchingOutbox)return 0;dispatchingOutbox=true;let delivered=0;
 try{
  const s=await getSchedulingPool().connect();let jobs:Array<{id:string;match_id:string;event_type:string}>;
  try{await s.query('BEGIN');const rows=await s.query(`SELECT id,match_id,event_type FROM scheduling_realtime_outbox
   WHERE dispatched_at IS NULL AND next_attempt_at<=NOW() AND (claimed_until IS NULL OR claimed_until<NOW())
   ORDER BY id FOR UPDATE SKIP LOCKED LIMIT $1`,[limit]);jobs=rows.rows;
   if(jobs.length)await s.query('UPDATE scheduling_realtime_outbox SET claimed_until=NOW()+INTERVAL \'30 seconds\',attempts=attempts+1 WHERE id=ANY($1::bigint[])',[jobs.map(j=>j.id)]);
   await s.query('COMMIT');}catch(e){await s.query('ROLLBACK');throw e;}finally{s.release();}
  for(const job of jobs){
   try{const c=await getPool().connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)',[sequenceLock]);
    const inserted=await c.query<{id:string;occurred_at:Date}>(`INSERT INTO match_realtime_events(match_id,event_type,source_system,source_event_id)
     VALUES($1,$2,'SCHEDULING',$3) ON CONFLICT(source_system,source_event_id) WHERE source_system IS NOT NULL AND source_event_id IS NOT NULL DO NOTHING RETURNING id,occurred_at`,[job.match_id,job.event_type,job.id]);
    if(inserted.rowCount){const e=inserted.rows[0];await c.query('SELECT pg_notify($1,$2)',[channel,JSON.stringify({id:e.id,matchId:job.match_id,type:job.event_type,occurredAt:e.occurred_at.toISOString()})]);}
    await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
    await getSchedulingPool().query('UPDATE scheduling_realtime_outbox SET dispatched_at=COALESCE(dispatched_at,NOW()),claimed_until=NULL,last_error=NULL WHERE id=$1',[job.id]);delivered++;
   }catch(error){await getSchedulingPool().query(`UPDATE scheduling_realtime_outbox SET claimed_until=NULL,next_attempt_at=NOW()+INTERVAL '5 seconds',last_error=$2 WHERE id=$1`,[job.id,error instanceof Error?error.message.slice(0,500):'delivery failed']).catch(()=>undefined);}
  }
 }finally{dispatchingOutbox=false;}
 return delivered;
}

/** Legacy callers wake the durable worker; publishing itself is never done from a second DB after a crash window. */
export async function publishCommittedMatchUpdate(_matchId:string,_type:string):Promise<void>{await processSchedulingRealtimeOutbox();}

async function maxRealtimeId():Promise<string>{return (await getPool().query("SELECT COALESCE(MAX(id),0)::text AS id FROM match_realtime_events")).rows[0].id;}
export async function getMatchRealtimeCursor():Promise<string>{return maxRealtimeId();}
function asEnvelope(row:{id:string;match_id:string;event_type:string;occurred_at:Date},all:boolean):RealtimeEnvelope{return {id:row.id,matchId:all?"":row.match_id,type:all?"live-feed.changed":row.event_type,occurredAt:new Date(row.occurred_at).toISOString()};}

async function replayMissedForExistingSubscribers(after:bigint,high:bigint):Promise<void>{
 if(high<=after)return;
 const min=BigInt((await getPool().query("SELECT COALESCE(MIN(id),0)::text AS id FROM match_realtime_events")).rows[0].id);
 if(min>0n&&after<min-1n){for(const entries of subscribers.values())for(const sub of entries)writeFrame(sub.response,"sync-required",{reason:"retention-gap",cursor:high.toString()},high.toString());return;}
 const rows=await getPool().query<{id:string;match_id:string;event_type:string;occurred_at:Date}>("SELECT id,match_id,event_type,occurred_at FROM match_realtime_events WHERE id>$1 AND id<=$2 ORDER BY id LIMIT $3",[after.toString(),high.toString(),replayLimit+1]);
 if(rows.rows.length>replayLimit){for(const entries of subscribers.values())for(const sub of entries)writeFrame(sub.response,"sync-required",{reason:"replay-limit",cursor:high.toString()},high.toString());return;}
 for(const row of rows.rows)deliver(asEnvelope(row,false));
}

async function connectListener(): Promise<void> {
 if(stopped)return;const client=new Client({connectionString:config.databaseUrl});listener=client;
 client.on("notification",message=>{if(message.channel!==channel||!message.payload)return;try{const e=JSON.parse(message.payload) as RealtimeEnvelope;const id=BigInt(e.id);if(lastObservedId!==null&&id<=lastObservedId)return;lastObservedId=id;deliver(e);}catch(error){console.error("[match-realtime] ignored malformed notification",error);}});
 client.on("error",error=>{console.error("[match-realtime] listener connection error",error);if(listener===client)listener=null;void client.end().catch(()=>undefined);scheduleReconnect();});
 try{await client.connect();await client.query(`LISTEN ${channel}`);const high=BigInt(await maxRealtimeId());
  if(everConnected&&lastObservedId!==null&&high>lastObservedId)await replayMissedForExistingSubscribers(lastObservedId,high);
  lastObservedId=high;everConnected=true;console.log("[match-realtime] PostgreSQL LISTEN connected");
 }catch(error){console.error("[match-realtime] could not connect listener",error);if(listener===client)listener=null;await client.end().catch(()=>undefined);scheduleReconnect();}
}
function scheduleReconnect(){if(stopped||reconnectTimer)return;reconnectTimer=setTimeout(()=>{reconnectTimer=null;void connectListener();},2000);reconnectTimer.unref();}

export async function startMatchRealtimeListener():Promise<void>{
 stopped=false;await processSchedulingRealtimeOutbox().catch(e=>console.error("[match-realtime] scheduling outbox retry",e instanceof Error?e.message:"failed"));await connectListener();
 replayTimer=setInterval(()=>{void processSchedulingRealtimeOutbox().catch(e=>console.error("[match-realtime] scheduling outbox retry",e instanceof Error?e.message:"failed"));},1000);replayTimer.unref();
 retentionTimer=setInterval(()=>{void Promise.all([getPool().query("DELETE FROM match_realtime_events WHERE occurred_at<NOW()-INTERVAL '30 days'"),getSchedulingPool().query("DELETE FROM scheduling_realtime_outbox WHERE dispatched_at<NOW()-INTERVAL '30 days'")]).catch(e=>console.error("[match-realtime] retention cleanup failed",e instanceof Error?e.message:"failed"));},24*60*60*1000);retentionTimer.unref();
}
export async function stopMatchRealtimeListener():Promise<void>{stopped=true;if(reconnectTimer)clearTimeout(reconnectTimer);reconnectTimer=null;if(replayTimer)clearInterval(replayTimer);replayTimer=null;if(retentionTimer)clearInterval(retentionTimer);retentionTimer=null;const current=listener;listener=null;if(current)await current.end().catch(()=>undefined);for(const entries of subscribers.values())for(const sub of entries)sub.response.end();subscribers.clear();}

function numericCursor(value:string|undefined){if(value&&/^\d+$/.test(value))return BigInt(value);return null;}
export async function subscribeToMatch(matchId:string,response:Response,lastEventId?:string,afterCursor?:string,authorize?:()=>Promise<boolean>):Promise<()=>void>{
 response.locals.realtimePublicFeed=matchId==="*";
 response.status(200);response.set({"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});response.flushHeaders();response.write(": connected\n\n");
 let entries=subscribers.get(matchId);if(!entries){entries=new Set();subscribers.set(matchId,entries);}const sub:Subscriber={response,replaying:true,buffer:[],authorize,checking:false,lastDeliveredId:0n};entries.add(sub);
 const heartbeat=setInterval(()=>{if(!response.writableEnded)response.write(": heartbeat\n\n");if(authorize&&!sub.checking){sub.checking=true;void authorize().then(allowed=>{if(!allowed){writeFrame(response,"access-revoked",{});response.end();}}).catch(()=>response.end()).finally(()=>{sub.checking=false;if(sub.buffer.length)void drainSubscriber(matchId,sub);});}},15000);heartbeat.unref();
 const unsubscribe=()=>{clearInterval(heartbeat);entries?.delete(sub);if(!entries?.size)subscribers.delete(matchId);};response.on("close",unsubscribe);
 let highCursor=0n;
 try{
  const high=BigInt(await maxRealtimeId());highCursor=high;const min=BigInt((await getPool().query("SELECT COALESCE(MIN(id),0)::text AS id FROM match_realtime_events")).rows[0].id);
  const cursor=numericCursor(lastEventId)??numericCursor(afterCursor);sub.lastDeliveredId=cursor??0n;
  const earlyDecision=classifyRealtimeReplay(cursor?.toString()??null,high.toString(),min.toString(),0);
  if(earlyDecision.kind==="snapshot"){sub.lastDeliveredId=high;writeFrame(response,"ready",{cursor:high.toString()},high.toString());}
  else if(earlyDecision.kind==="sync-required"){sub.lastDeliveredId=high;writeFrame(response,"sync-required",{reason:earlyDecision.reason,cursor:high.toString()},high.toString());}
  else{
   const backlog=matchId==="*"
    ? await getPool().query<{id:string;match_id:string;event_type:string;occurred_at:Date}>("SELECT id,match_id,event_type,occurred_at FROM match_realtime_events WHERE id>$1 AND id<=$2 ORDER BY id LIMIT $3",[cursor!.toString(),high.toString(),replayLimit+1])
    : await getPool().query<{id:string;match_id:string;event_type:string;occurred_at:Date}>("SELECT id,match_id,event_type,occurred_at FROM match_realtime_events WHERE id>$1 AND id<=$2 AND match_id=$3::uuid ORDER BY id LIMIT $4",[cursor!.toString(),high.toString(),matchId,replayLimit+1]);
   const decision=classifyRealtimeReplay(cursor!.toString(),high.toString(),min.toString(),backlog.rows.length);
   if(decision.kind==="sync-required"){sub.lastDeliveredId=high;writeFrame(response,"sync-required",{reason:decision.reason,cursor:high.toString()},high.toString());}
   else {for(const row of backlog.rows){const envelope=asEnvelope(row,matchId==="*");if(BigInt(envelope.id)>sub.lastDeliveredId){sendMatchUpdate(sub,envelope);sub.lastDeliveredId=BigInt(envelope.id);}}}
  }
 }catch(error){console.error("[match-realtime] replay failed",error);sub.lastDeliveredId=highCursor;writeFrame(response,"sync-required",{reason:"replay-failed",cursor:highCursor.toString()},highCursor.toString());}
 sub.replaying=false;sub.buffer=sub.buffer.filter(e=>BigInt(e.id)>highCursor);void drainSubscriber(matchId,sub);
 return unsubscribe;
}

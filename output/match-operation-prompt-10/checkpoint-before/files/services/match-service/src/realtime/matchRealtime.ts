import type { Response } from "express";
import { Client, type PoolClient } from "pg";
import { config } from "../config";
import { getPool } from "../lib/db";

const channel = "sfl_match_realtime";
type RealtimeEnvelope = { id: string; matchId: string; type: string; occurredAt: string };
const subscribers = new Map<string, Set<Response>>();
let listener: Client | null = null;
let stopped = false;
let retryTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;

function send(res: Response, envelope: RealtimeEnvelope): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`id: ${envelope.id}\nevent: match-update\ndata: ${JSON.stringify(envelope)}\n\n`);
}

export async function publishMatchUpdate(client: PoolClient, matchId: string, type: string): Promise<void> {
  const saved = await client.query<{ id: string; occurred_at: Date }>(
    `INSERT INTO match_realtime_events (match_id, event_type)
     VALUES ($1, $2) RETURNING id, occurred_at`, [matchId, type],
  );
  const envelope: RealtimeEnvelope = {
    id: saved.rows[0].id,
    matchId,
    type,
    occurredAt: saved.rows[0].occurred_at.toISOString(),
  };
  await client.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(envelope)]);
}

/**
 * Scheduling data lives in its own database. Publish only after that transaction
 * commits, using the Match database that owns the durable realtime event log.
 * The durable event remains replayable if PostgreSQL notification delivery fails.
 */
export async function publishCommittedMatchUpdate(matchId: string, type: string): Promise<void> {
  try {
    const saved = await getPool().query<{ id: string; occurred_at: Date }>(
      `INSERT INTO match_realtime_events (match_id, event_type)
       VALUES ($1, $2) RETURNING id, occurred_at`, [matchId, type],
    );
    const envelope: RealtimeEnvelope = {
      id: saved.rows[0].id,
      matchId,
      type,
      occurredAt: saved.rows[0].occurred_at.toISOString(),
    };
    await getPool().query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(envelope)]);
  } catch (error) {
    // The schedule transaction is already committed. Do not return a false
    // failure to the caller; the event log/realtime relay can be diagnosed
    // independently without rolling back committed scheduling data.
    console.error("[match-realtime] could not publish committed schedule update", error);
  }
}

async function connectListener(): Promise<void> {
  if (stopped) return;
  const client = new Client({ connectionString: config.databaseUrl });
  listener = client;
  client.on("notification", (message) => {
    if (message.channel !== channel || !message.payload) return;
    try {
      const envelope = JSON.parse(message.payload) as RealtimeEnvelope;
      for (const response of subscribers.get(envelope.matchId) ?? []) send(response, envelope);
      for (const response of subscribers.get("*") ?? []) send(response, { ...envelope, matchId: "", type: "live-feed.changed" });
    } catch (error) {
      console.error("[match-realtime] ignored malformed notification", error);
    }
  });
  client.on("error", (error) => {
    console.error("[match-realtime] listener connection error", error);
    if (listener === client) listener = null;
    void client.end().catch(() => undefined);
    scheduleReconnect();
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${channel}`);
    console.log("[match-realtime] PostgreSQL LISTEN connected");
  } catch (error) {
    console.error("[match-realtime] could not connect listener", error);
    if (listener === client) listener = null;
    await client.end().catch(() => undefined);
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (stopped || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connectListener();
  }, 2000);
  retryTimer.unref();
}

export async function startMatchRealtimeListener(): Promise<void> {
  stopped = false;
  await connectListener();
  retentionTimer = setInterval(() => {
    void getPool().query("DELETE FROM match_realtime_events WHERE occurred_at < NOW() - INTERVAL '30 days'")
      .catch((error: unknown) => console.error("[match-realtime] retention cleanup failed", error));
  }, 24 * 60 * 60 * 1000);
  retentionTimer.unref();
}

export async function stopMatchRealtimeListener(): Promise<void> {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (retentionTimer) clearInterval(retentionTimer);
  retentionTimer = null;
  const current = listener;
  listener = null;
  if (current) await current.end().catch(() => undefined);
  for (const entries of subscribers.values()) for (const response of entries) response.end();
  subscribers.clear();
}

export async function subscribeToMatch(matchId: string, response: Response, lastEventId?: string): Promise<() => void> {
  response.status(200);
  response.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write(": connected\n\n");
  let entries = subscribers.get(matchId);
  if (!entries) { entries = new Set(); subscribers.set(matchId, entries); }
  entries.add(response);
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, 15000);
  heartbeat.unref();
  const unsubscribe = () => {
    clearInterval(heartbeat);
    entries?.delete(response);
    if (!entries?.size) subscribers.delete(matchId);
  };
  response.on("close", unsubscribe);

  if (lastEventId && /^\d+$/.test(lastEventId)) {
    try {
      const backlog = matchId === "*"
        ? await getPool().query<{ id: string; match_id: string; event_type: string; occurred_at: Date }>(
            "SELECT id, match_id, event_type, occurred_at FROM match_realtime_events WHERE id > $1 ORDER BY id ASC LIMIT 200", [lastEventId],
          )
        : await getPool().query<{ id: string; match_id: string; event_type: string; occurred_at: Date }>(
            `SELECT id, match_id, event_type, occurred_at FROM match_realtime_events
             WHERE match_id = $1 AND id > $2 ORDER BY id ASC LIMIT 200`, [matchId, lastEventId],
          );
      for (const row of backlog.rows) send(response, {
        id: row.id,
        matchId: matchId === "*" ? "" : row.match_id,
        type: matchId === "*" ? "live-feed.changed" : row.event_type,
        occurredAt: row.occurred_at.toISOString(),
      });
    } catch (error) {
      console.error("[match-realtime] event replay failed", error);
      response.write("event: sync-required\ndata: {}\n\n");
    }
  }
  return unsubscribe;
}

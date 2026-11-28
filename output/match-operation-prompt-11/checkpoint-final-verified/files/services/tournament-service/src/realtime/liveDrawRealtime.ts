import type { Response } from "express";
import { Client } from "pg";
import { config } from "../config";

type DrawEvent = { tournamentId: string; sessionId?: string; sequence?: number; type: string };

const subscribers = new Map<string, Set<Response>>();
let listener: Client | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let stopped = false;

function publish(event: DrawEvent): void {
  const clients = subscribers.get(event.tournamentId);
  if (!clients) return;
  const message = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of clients) {
    if (!response.writableEnded) response.write(message);
  }
}

async function connectListener(): Promise<void> {
  if (stopped || listener) return;
  const client = new Client({ connectionString: config.databaseUrl });
  listener = client;
  client.on("notification", (notification) => {
    if (notification.channel !== "sfl_tournament_live_draw" || !notification.payload) return;
    try {
      const event = JSON.parse(notification.payload) as DrawEvent;
      if (typeof event.tournamentId === "string" && typeof event.type === "string") publish(event);
    } catch {
      // Ignore malformed internal notifications; public state is always reloaded from the database.
    }
  });
  const reconnect = () => {
    if (listener !== client) return;
    listener = null;
    if (!stopped && !retryTimer) retryTimer = setTimeout(() => {
      retryTimer = null;
      void connectListener();
    }, 1500);
  };
  client.on("error", reconnect);
  client.on("end", reconnect);
  try {
    await client.connect();
    await client.query("LISTEN sfl_tournament_live_draw");
  } catch {
    reconnect();
    void client.end().catch(() => undefined);
  }
}

export function startLiveDrawListener(): void {
  stopped = false;
  void connectListener();
}

export function subscribeToLiveDraw(tournamentId: string, response: Response): () => void {
  response.status(200);
  response.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write("event: ready\ndata: {}\n\n");
  const clients = subscribers.get(tournamentId) ?? new Set<Response>();
  clients.add(response);
  subscribers.set(tournamentId, clients);
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, 20_000);
  const unsubscribe = () => {
    clearInterval(heartbeat);
    clients.delete(response);
    if (clients.size === 0) subscribers.delete(tournamentId);
  };
  response.on("close", unsubscribe);
  return unsubscribe;
}

export async function stopLiveDrawListener(): Promise<void> {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const current = listener;
  listener = null;
  if (current) await current.end().catch(() => undefined);
}

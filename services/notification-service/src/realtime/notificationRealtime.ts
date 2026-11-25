import type { Response } from "express";
import { Client } from "pg";
import { config } from "../config";

type NotificationEvent = { userId: string; notificationId: number };
const subscribers = new Map<string, Set<Response>>();
let listener: Client | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let stopped = false;

function publish(event: NotificationEvent): void {
  const clients = subscribers.get(event.userId);
  if (!clients) return;
  const message = `event: notification\ndata: ${JSON.stringify({ notificationId: event.notificationId })}\n\n`;
  for (const response of clients) if (!response.writableEnded) response.write(message);
}

async function connectListener(): Promise<void> {
  if (stopped || listener) return;
  const client = new Client({ connectionString: config.databaseUrl });
  listener = client;
  const reconnect = () => {
    if (listener !== client) return;
    listener = null;
    if (!stopped && !retryTimer) retryTimer = setTimeout(() => {
      retryTimer = null;
      void connectListener();
    }, 1500);
  };
  client.on("notification", (notification) => {
    if (notification.channel !== "sfl_user_notifications" || !notification.payload) return;
    try {
      const value = JSON.parse(notification.payload) as Partial<NotificationEvent>;
      if (typeof value.userId === "string" && Number.isSafeInteger(value.notificationId)) {
        publish(value as NotificationEvent);
      }
    } catch {
      // The stream carries only an invalidation hint; clients reload authorized data over HTTP.
    }
  });
  client.on("error", reconnect);
  client.on("end", reconnect);
  try {
    await client.connect();
    await client.query("LISTEN sfl_user_notifications");
  } catch {
    reconnect();
    void client.end().catch(() => undefined);
  }
}

export function startNotificationListener(): void {
  stopped = false;
  void connectListener();
}

export function subscribeToUserNotifications(userId: string, response: Response): void {
  response.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write("event: ready\ndata: {}\n\n");
  const clients = subscribers.get(userId) ?? new Set<Response>();
  clients.add(response);
  subscribers.set(userId, clients);
  const heartbeat = setInterval(() => {
    if (!response.writableEnded) response.write(": heartbeat\n\n");
  }, 20_000);
  response.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(response);
    if (clients.size === 0) subscribers.delete(userId);
  });
}

export async function stopNotificationListener(): Promise<void> {
  stopped = true;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const current = listener;
  listener = null;
  if (current) await current.end().catch(() => undefined);
}

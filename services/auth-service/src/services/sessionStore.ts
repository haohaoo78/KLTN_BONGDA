import { randomBytes } from "crypto";
import type { SessionData } from "@sfl/shared";
import { config } from "../config";
import { getRedis } from "../lib/redis";

function sessionKey(sessionId: string): string {
  return `session:${sessionId}`;
}

export function createSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export async function saveSession(
  sessionId: string,
  data: SessionData,
): Promise<void> {
  const redis = getRedis();
  await redis.setex(
    sessionKey(sessionId),
    config.sessionTtlSeconds,
    JSON.stringify(data),
  );
}

export async function getSession(
  sessionId: string,
): Promise<SessionData | null> {
  const redis = getRedis();
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(sessionKey(sessionId));
}

export async function deleteUserSessions(userId: string): Promise<void> {
  const redis = getRedis();
  let cursor = "0";
  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      "session:*",
      "COUNT",
      100,
    );
    cursor = nextCursor;
    if (!keys.length) continue;

    const values = await redis.mget(...keys);
    const sessionsToDelete = keys.filter((_, index) => {
      const value = values[index];
      return value !== null && (JSON.parse(value) as SessionData).userId === userId;
    });
    if (sessionsToDelete.length) {
      await redis.del(...sessionsToDelete);
    }
  } while (cursor !== "0");
}

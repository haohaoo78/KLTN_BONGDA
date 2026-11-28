import Redis from "ioredis";
import { config } from "../config";

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
    });
  }
  return client;
}

export async function connectRedis(): Promise<void> {
  await getRedis().ping();
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}

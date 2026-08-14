import { Redis } from "ioredis";
import { env } from "./config.js";

let redis: Redis | null = null;

function shouldUseRedis(): boolean {
  const url = env.REDIS_URL;
  if (!url) return false;
  if (process.env.VERCEL && /localhost|127\.0\.0\.1/i.test(url)) return false;
  return true;
}

export async function connectRedis(): Promise<void> {
  if (!shouldUseRedis() || redis) return;
  const client = new Redis(env.REDIS_URL!, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  if (client.status === "wait") {
    await client.connect();
  }
  redis = client;
}

export async function kvGet(key: string): Promise<string | null> {
  if (!redis) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function kvSetEx(key: string, ttlSec: number, value: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.setex(key, ttlSec, value);
  } catch {
    // cache miss is fine
  }
}

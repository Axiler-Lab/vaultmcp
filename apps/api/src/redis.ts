import { Redis } from "ioredis";
import { env } from "./config.js";

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

export async function connectRedis(): Promise<void> {
  if (redis.status === "wait") {
    await redis.connect();
  }
}

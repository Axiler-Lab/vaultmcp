import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../apps/api/dist/app.js";
import { connectRedis } from "../apps/api/dist/redis.js";

const app = createApp();
let redisReady: Promise<void> | null = null;

function ensureRedis(): Promise<void> {
  redisReady ??= connectRedis().catch((err) => {
    console.error("Redis unavailable:", err);
  });
  return redisReady;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await ensureRedis();
  return app(req, res);
}

export const config = {
  maxDuration: 60,
};

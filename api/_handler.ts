import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../apps/api/dist/app.js";
import { connectRedis } from "../apps/api/dist/redis.js";

const app = createApp();
let redisReady: Promise<void> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  redisReady ??= connectRedis().catch((err) => {
    console.error("Redis unavailable:", err);
  });
  await redisReady;
  return app(req, res);
}

export const config = {
  maxDuration: 60,
};

import type { IncomingMessage, ServerResponse } from "node:http";
import { createApp } from "../apps/api/dist/app.js";
import { connectRedis } from "../apps/api/dist/redis.js";

const app = createApp();
let redisReady: Promise<void> | null = null;

/**
 * Rewrites send /auth/github/callback to /api?url=/auth/github/callback
 * (and keep code/state on the query string). Restore Express's path.
 */
function restoreRewrittenUrl(req: IncomingMessage) {
  const raw = req.url ?? "/";
  const host = typeof req.headers.host === "string" ? req.headers.host : "localhost";
  let parsed: URL;
  try {
    parsed = new URL(raw, `https://${host}`);
  } catch {
    return;
  }
  const orig = parsed.searchParams.get("url");
  if (!orig || !orig.startsWith("/") || orig.startsWith("//")) return;
  parsed.searchParams.delete("url");
  const q = parsed.searchParams.toString();
  req.url = q ? `${orig}?${q}` : orig;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  restoreRewrittenUrl(req);
  redisReady ??= connectRedis().catch((err) => {
    console.error("Redis unavailable:", err);
  });
  await redisReady;
  return app(req, res);
}

export const config = {
  maxDuration: 60,
};

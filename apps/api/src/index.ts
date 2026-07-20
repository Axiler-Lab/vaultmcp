import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { authRouter } from "./auth/github.js";
import { mcpOauthRouter, requireMcpBearer } from "./auth/mcp-oauth.js";
import { env } from "./config.js";
import { handleMcpRequest } from "./mcp/gateway.js";
import { connectRedis } from "./redis.js";
import { apiRouter } from "./routes/api.js";
import { runtimeRouter } from "./routes/runtime.js";
import { HttpError } from "./services/workspaces.js";

/** Paths used by Cursor/Electron MCP clients (Bearer auth — not cookies). */
function isMcpPublicSurface(path: string): boolean {
  return (
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path.startsWith("/.well-known/") ||
    path.startsWith("/oauth/")
  );
}

/** Runtime env export — CLI only; no browser CORS (no Access-Control-Allow-Origin). */
function isRuntimeSurface(path: string): boolean {
  return path === "/api/runtime" || path.startsWith("/api/runtime/");
}

/**
 * MCP/OAuth discovery must reflect the request Origin (including the literal
 * string "null" from Electron/Chromium). A fixed WEB_ORIGIN + credentials
 * causes Chromium to surface net::ERR_FAILED before OAuth can start.
 * Working remote MCPs (e.g. Notion) echo Origin and do not set credentials.
 */
const mcpCors = cors({
  origin: true,
  credentials: false,
  methods: ["GET", "HEAD", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "MCP-Protocol-Version",
    "MCP-Session-Id",
    "Last-Event-ID",
  ],
  exposedHeaders: ["MCP-Session-Id", "WWW-Authenticate"],
  maxAge: 86400,
});

const webCors = cors({
  origin: env.WEB_ORIGIN,
  credentials: true,
});

async function main() {
  await connectRedis();

  const app = express();
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    if (isMcpPublicSurface(req.path)) {
      return mcpCors(req, res, next);
    }
    // No CORS for runtime export — browsers must not call this cross-origin.
    if (isRuntimeSurface(req.path)) {
      return next();
    }
    return webCors(req, res, next);
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => isRuntimeSurface(req.path),
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "vaultmcp-api" });
  });

  app.use(mcpOauthRouter);
  app.use("/auth", authRouter);
  app.use("/api/runtime", runtimeRouter);
  app.use("/api", apiRouter);

  const mcpHandler = async (req: express.Request, res: express.Response) => {
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    try {
      await handleMcpRequest(req, res);
    } catch (err) {
      console.error("MCP error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "mcp_error" });
      }
    }
  };

  // Accept /mcp and /mcp/ — nginx prefix + Express both need the trailing slash
  app.all(["/mcp", "/mcp/"], requireMcpBearer, mcpHandler);

  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ZodError) {
        res.status(400).json({ error: "validation_error", details: err.flatten() });
        return;
      }
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "internal_error" });
    },
  );

  app.listen(env.PORT, () => {
    console.log(`VaultMCP API listening on ${env.PUBLIC_URL} (port ${env.PORT})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { isAllowedCsrfOrigin } from "@vaultmcp/shared";
import { authRouter } from "./auth/github.js";
import { mcpOauthRouter, requireMcpBearer } from "./auth/mcp-oauth.js";
import { env } from "./config.js";
import { handleMcpRequest } from "./mcp/gateway.js";
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

/**
 * Vercel only hosts functions under /api/*. Backend routes like /auth and /mcp
 * are rewritten to /api/auth, /api/mcp, etc. Restore the Express paths.
 * REST /api/* is left unchanged.
 */
function restoreVercelPath(req: express.Request, _res: express.Response, next: express.NextFunction) {
  if (!process.env.VERCEL) {
    next();
    return;
  }
  const raw = req.url ?? "/";
  const q = raw.indexOf("?");
  const pathname = q === -1 ? raw : raw.slice(0, q);
  const search = q === -1 ? "" : raw.slice(q);
  let nextPath = pathname;
  if (pathname === "/api/health" || pathname.startsWith("/api/health/")) {
    nextPath = "/health";
  } else if (pathname.startsWith("/api/well-known/")) {
    nextPath = `/.well-known/${pathname.slice("/api/well-known/".length)}`;
  } else if (pathname.startsWith("/api/.well-known/")) {
    nextPath = pathname.slice("/api".length);
  } else if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/oauth") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/")
  ) {
    nextPath = pathname.slice("/api".length) || "/";
  }
  if (nextPath !== pathname) {
    req.url = `${nextPath}${search}`;
  }
  next();
}

export function createApp(): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(restoreVercelPath);

  app.use((req, res, next) => {
    if (isMcpPublicSurface(req.path)) {
      return mcpCors(req, res, next);
    }
    if (isRuntimeSurface(req.path)) {
      return next();
    }
    return webCors(req, res, next);
  });
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    if (isMcpPublicSurface(req.path) || isRuntimeSurface(req.path)) {
      next();
      return;
    }
    const token = req.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
    if (!token) {
      next();
      return;
    }
    if (!isAllowedCsrfOrigin(req.get("origin") ?? undefined, env.WEB_ORIGIN)) {
      res.status(403).json({ error: "csrf" });
      return;
    }
    next();
  });

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

  return app;
}

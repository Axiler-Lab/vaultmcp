import type { NextFunction, Request, Response } from "express";
import { getUserById } from "./session.js";
import { authenticateApiToken, isApiToken } from "../services/tokens.js";

declare global {
  namespace Express {
    interface Request {
      /** Present on `/api/runtime/*` after PAT auth. */
      runtimeTokenPrefix?: string;
      runtimeTokenId?: string;
    }
  }
}

/**
 * PAT-only auth for runtime env export.
 * Rejects missing/invalid Bearer, OAuth tokens, and does not use session cookies.
 */
export async function requireRuntimePat(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized", message: "Bearer personal access token required" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();
  if (!isApiToken(token)) {
    res.status(401).json({
      error: "invalid_token",
      message: "Runtime env requires a dashboard personal access token (vmcp_…)",
    });
    return;
  }

  const auth = await authenticateApiToken(token);
  if (!auth.ok) {
    if (auth.reason === "expired") {
      res.status(401).json({
        error: "token_expired",
        message: "Personal access token has expired",
      });
      return;
    }
    res.status(401).json({ error: "invalid_token" });
    return;
  }

  const user = await getUserById(auth.userId);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  req.user = user;
  req.patScopes = auth.scopes;
  req.runtimeTokenPrefix = auth.tokenPrefix;
  req.runtimeTokenId = auth.tokenId;
  next();
}

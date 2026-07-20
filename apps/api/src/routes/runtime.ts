import { Router } from "express";
import rateLimit from "express-rate-limit";
import { hasApiTokenScope } from "@vaultmcp/shared";
import { ZodError } from "zod";
import { requireRuntimePat } from "../auth/runtime-pat.js";
import { env } from "../config.js";
import * as secrets from "../services/secrets.js";
import { writeAudit } from "../services/upstreams.js";
import {
  HttpError,
  getMembership,
  getWorkspaceById,
  getWorkspaceBySlug,
} from "../services/workspaces.js";

export const runtimeRouter = Router();

const runtimeLimiter = rateLimit({
  windowMs: Math.min(env.RATE_LIMIT_WINDOW_MS, 60_000),
  max: Math.min(30, Math.max(10, Math.floor(env.RATE_LIMIT_MAX / 4))),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate_limited", message: "Too many runtime env requests" },
});

runtimeRouter.use(runtimeLimiter);
runtimeRouter.use(requireRuntimePat);

function setNoStore(res: import("express").Response) {
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
}

function handleError(res: import("express").Response, err: unknown) {
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
}

/**
 * GET /api/runtime/v1/env?workspace=<slug>|workspaceId=<uuid>&names=A,B
 * Returns decryptable secrets for CLI `vaultmcp run` / `env`.
 */
runtimeRouter.get("/v1/env", async (req, res) => {
  setNoStore(res);
  try {
    const scopes = req.patScopes ?? [];
    if (!hasApiTokenScope(scopes, "env")) {
      res.status(403).json({
        error: "forbidden",
        message: "Personal access token lacks env scope",
      });
      return;
    }

    const workspaceIdParam =
      typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : "";
    const workspaceSlug =
      typeof req.query.workspace === "string" ? req.query.workspace.trim() : "";

    if (!workspaceIdParam && !workspaceSlug) {
      res.status(400).json({ error: "workspace or workspaceId query parameter required" });
      return;
    }

    const workspace = workspaceIdParam
      ? await getWorkspaceById(workspaceIdParam)
      : await getWorkspaceBySlug(workspaceSlug);
    if (!workspace) {
      res.status(404).json({ error: "workspace_not_found" });
      return;
    }

    const membership = await getMembership(workspace.id, req.user!.id);
    if (!membership) {
      res.status(403).json({ error: "forbidden", message: "Not a workspace member" });
      return;
    }

    const namesRaw = typeof req.query.names === "string" ? req.query.names : "";
    const names = namesRaw
      ? namesRaw
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
      : undefined;

    const { names: exportedNames, secrets: secretMap } =
      await secrets.resolveSecretsForRuntimeExport(workspace.id, req.user!.id, names);

    await writeAudit({
      workspaceId: workspace.id,
      userId: req.user!.id,
      action: "runtime_env_export",
      allowed: true,
      detail: {
        tokenPrefix: req.runtimeTokenPrefix,
        tokenId: req.runtimeTokenId,
        names: exportedNames,
        count: exportedNames.length,
      },
    });

    res.json({
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
      secrets: secretMap,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof HttpError) {
      await writeAudit({
        userId: req.user?.id,
        action: "runtime_env_export",
        allowed: false,
        detail: {
          tokenPrefix: req.runtimeTokenPrefix,
          reason: err.message,
        },
      }).catch(() => undefined);
    }
    handleError(res, err);
  }
});

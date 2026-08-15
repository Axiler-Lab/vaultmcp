import { Router } from "express";
import {
  CreateApiTokenSchema,
  CreateSecretSchema,
  CreateUpstreamSchema,
  CreateWorkspaceSchema,
  InviteMemberSchema,
  MCP_CLIENT_SERVER_KEY,
  UpdateMemberRoleSchema,
  UpdateSecretSchema,
  UpdateUpstreamSchema,
} from "@vaultmcp/shared";
import { ZodError } from "zod";
import { getUserById, requireWebAuth, setDefaultWorkspace } from "../auth/session.js";
import { HttpError } from "../services/workspaces.js";
import * as workspaces from "../services/workspaces.js";
import * as secrets from "../services/secrets.js";
import * as tokens from "../services/tokens.js";
import * as upstreams from "../services/upstreams.js";
import { env } from "../config.js";

export const apiRouter = Router();

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

apiRouter.use(requireWebAuth);

apiRouter.get("/config", (_req, res) => {
  res.json({
    publicUrl: env.PUBLIC_URL,
    mcpUrl: `${env.PUBLIC_URL}/mcp`,
    cursorConfig: {
      mcpServers: {
        [MCP_CLIENT_SERVER_KEY]: {
          url: `${env.PUBLIC_URL}/mcp`,
        },
      },
    },
  });
});

// Workspaces
apiRouter.get("/workspaces", async (req, res) => {
  try {
    const list = await workspaces.listWorkspacesForUser(req.user!.id);
    res.json({ workspaces: list });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.post("/workspaces", async (req, res) => {
  try {
    const body = CreateWorkspaceSchema.parse(req.body);
    const ws = await workspaces.createWorkspace(req.user!.id, body.name, body.slug);
    res.status(201).json({ workspace: ws });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.get("/workspaces/:id", async (req, res) => {
  try {
    await workspaces.requireMembership(req.params.id, req.user!.id, "viewer");
    const ws = await workspaces.getWorkspaceById(req.params.id);
    if (!ws) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const membership = await workspaces.getMembership(req.params.id, req.user!.id);
    res.json({ workspace: workspaces.toPublicWorkspace(ws), role: membership?.role });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.post("/workspaces/:id/default", async (req, res) => {
  try {
    const workspaceId = req.params.id;
    await workspaces.requireMembership(workspaceId, req.user!.id, "viewer");
    await setDefaultWorkspace(req.user!.id, workspaceId);
    const user = await getUserById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ ok: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.delete("/workspaces/:id", async (req, res) => {
  try {
    await workspaces.deleteWorkspace(req.params.id, req.user!.id);
    const user = await getUserById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ ok: true, user });
  } catch (err) {
    handleError(res, err);
  }
});

// Members
apiRouter.get("/workspaces/:id/members", async (req, res) => {
  try {
    await workspaces.requireMembership(req.params.id, req.user!.id, "viewer");
    const members = await workspaces.listMembers(req.params.id);
    res.json({ members });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.post("/workspaces/:id/members", async (req, res) => {
  try {
    const body = InviteMemberSchema.parse(req.body);
    const member = await workspaces.inviteMember(
      req.params.id,
      req.user!.id,
      body.githubLogin,
      body.role,
    );
    res.status(201).json({ member });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.patch("/workspaces/:id/members/:memberId", async (req, res) => {
  try {
    const body = UpdateMemberRoleSchema.parse(req.body);
    const member = await workspaces.updateMemberRole(
      req.params.id,
      req.user!.id,
      req.params.memberId,
      body.role,
    );
    res.json({ member });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.delete("/workspaces/:id/members/:memberId", async (req, res) => {
  try {
    await workspaces.removeMember(req.params.id, req.user!.id, req.params.memberId);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Secrets (write-only values)
apiRouter.get("/workspaces/:id/secrets", async (req, res) => {
  try {
    const list = await secrets.listSecrets(req.params.id, req.user!.id);
    res.json({ secrets: list });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.post("/workspaces/:id/secrets", async (req, res) => {
  try {
    const body = CreateSecretSchema.parse(req.body);
    const secret = await secrets.createSecret(req.params.id, req.user!.id, body);
    res.status(201).json({ secret });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.patch("/workspaces/:id/secrets/:secretId", async (req, res) => {
  try {
    const body = UpdateSecretSchema.parse(req.body);
    const secret = await secrets.updateSecret(
      req.params.id,
      req.user!.id,
      req.params.secretId,
      body,
    );
    res.json({ secret });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.delete("/workspaces/:id/secrets/:secretId", async (req, res) => {
  try {
    await secrets.deleteSecret(req.params.id, req.user!.id, req.params.secretId);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Upstreams
apiRouter.get("/workspaces/:id/upstreams", async (req, res) => {
  try {
    const list = await upstreams.listUpstreams(req.params.id, req.user!.id);
    res.json({ upstreams: list });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.post("/workspaces/:id/upstreams", async (req, res) => {
  try {
    const body = CreateUpstreamSchema.parse(req.body);
    const upstream = await upstreams.createUpstream(req.params.id, req.user!.id, body);
    res.status(201).json({ upstream });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.patch("/workspaces/:id/upstreams/:upstreamId", async (req, res) => {
  try {
    const body = UpdateUpstreamSchema.parse(req.body);
    const upstream = await upstreams.updateUpstream(
      req.params.id,
      req.user!.id,
      req.params.upstreamId,
      body,
    );
    res.json({ upstream });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.delete("/workspaces/:id/upstreams/:upstreamId", async (req, res) => {
  try {
    await upstreams.deleteUpstream(req.params.id, req.user!.id, req.params.upstreamId);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

// Audit
apiRouter.get("/workspaces/:id/audit", async (req, res) => {
  try {
    const logs = await upstreams.listAuditLogs(req.params.id, req.user!.id);
    res.json({ logs });
  } catch (err) {
    handleError(res, err);
  }
});

// Personal access tokens (MCP Bearer `vmcp_…`)
apiRouter.get("/tokens", async (req, res) => {
  try {
    const list = await tokens.listTokens(req.user!.id);
    res.json({ tokens: list });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.post("/tokens", async (req, res) => {
  try {
    const body = CreateApiTokenSchema.parse(req.body ?? {});
    const created = await tokens.createToken(req.user!.id, {
      name: body.name,
      scopes: body.scopes,
      expiresInDays: body.expiresInDays,
      expiresAt: body.expiresAt,
    });
    res.status(201).json({
      token: {
        id: created.id,
        name: created.name,
        tokenPrefix: created.tokenPrefix,
        scopes: created.scopes,
        expiresAt: created.expiresAt,
        createdAt: created.createdAt,
        lastUsedAt: created.lastUsedAt,
        /** Plaintext shown once — never stored or listed again. */
        secret: created.token,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

apiRouter.delete("/tokens/:id", async (req, res) => {
  try {
    await tokens.revokeToken(req.user!.id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, err);
  }
});

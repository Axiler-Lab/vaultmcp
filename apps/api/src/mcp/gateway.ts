import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import {
  CreateSecretSchema,
  CreateUpstreamSchema,
  INTEGRATION_TEMPLATES,
  canManageWorkspace,
  canUseSecrets,
  getIntegrationTemplate,
  hasApiTokenScope,
  namespaceTool,
  parseNamespacedTool,
  roleAtLeast,
  type ApiTokenScope,
  type SecretVisibility,
  type WorkspaceRole,
} from "@vaultmcp/shared";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { AuthUser } from "../auth/session.js";
import { getUserById, setDefaultWorkspace } from "../auth/session.js";
import { kvGet, kvSetEx } from "../redis.js";
import { connectUpstream } from "./upstream-client.js";
import * as secrets from "../services/secrets.js";
import {
  createUpstream,
  getUpstreamBySlug,
  listUpstreams,
  updateUpstream,
  writeAudit,
} from "../services/upstreams.js";
import {
  HttpError,
  getMembership,
  getWorkspaceById,
  listWorkspacesForUser,
} from "../services/workspaces.js";

type GatewayAuth = {
  user: AuthUser;
  /** Set for PAT auth; undefined for OAuth (role-only write rules). */
  patScopes?: ApiTokenScope[];
};

type SessionState = {
  userId: string;
  workspaceId: string | null;
};

async function getSessionState(user: AuthUser): Promise<SessionState> {
  const key = `mcp:ws:${user.id}`;
  const cached = await kvGet(key);
  if (cached) {
    return { userId: user.id, workspaceId: cached };
  }
  // Re-read the user instead of trusting the AuthUser captured at session
  // creation: its defaultWorkspaceId is frozen at initialize time, so a
  // use_workspace switch would not take effect on this session whenever the
  // cache layer is unavailable.
  const current = await getUserById(user.id);
  const defaultWorkspaceId = current?.defaultWorkspaceId ?? null;
  if (defaultWorkspaceId) {
    const m = await getMembership(defaultWorkspaceId, user.id);
    if (m) {
      await kvSetEx(key, 86400, defaultWorkspaceId);
      return { userId: user.id, workspaceId: defaultWorkspaceId };
    }
  }
  return { userId: user.id, workspaceId: null };
}

async function setSessionWorkspace(userId: string, workspaceId: string) {
  await kvSetEx(`mcp:ws:${userId}`, 86400, workspaceId);
  await setDefaultWorkspace(userId, workspaceId);
}

function textResult(data: unknown, isError = false) {
  return {
    isError,
    content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string) {
  return textResult(message, true);
}

/** PAT without write cannot mutate vault; OAuth uses workspace role only. */
function hasWriteCapability(auth: GatewayAuth): boolean {
  if (auth.patScopes) {
    return hasApiTokenScope(auth.patScopes, "write");
  }
  return true;
}

function hasReadCapability(auth: GatewayAuth): boolean {
  if (auth.patScopes) {
    return hasApiTokenScope(auth.patScopes, "read");
  }
  return true;
}

async function requireActiveWorkspace(
  auth: GatewayAuth,
  state: SessionState,
  minimumRole: WorkspaceRole = "viewer",
) {
  if (!state.workspaceId) {
    throw new HttpError(400, "Select a workspace first with use_workspace");
  }
  const membership = await getMembership(state.workspaceId, auth.user.id);
  if (!membership || !roleAtLeast(membership.role, minimumRole)) {
    throw new HttpError(403, `Requires workspace role ${minimumRole} or higher`);
  }
  return { workspaceId: state.workspaceId, membership };
}

function gatewayTools(): Tool[] {
  const g = (text: string) => `[VaultMCP] ${text}`;
  return [
    {
      name: "list_workspaces",
      description: g("List workspaces you can access"),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "use_workspace",
      description: g(
        "Select the active workspace for upstream tools (e.g. github__…). Required before calling namespaced tools.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          workspace_id: { type: "string", description: "Workspace UUID" },
          slug: { type: "string", description: "Workspace slug (alternative to workspace_id)" },
        },
        additionalProperties: false,
      },
    },
    {
      name: "current_workspace",
      description: g("Show the currently selected workspace"),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "list_upstreams",
      description: g(
        "List upstream MCP servers in the active workspace (metadata only; no secret values)",
      ),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "list_secrets",
      description: g(
        "List secret metadata in the active workspace (name, visibility, createdAt). Never returns values.",
      ),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "list_templates",
      description: g(
        "List integration templates (GitHub, AWS, custom). Does not install anything.",
      ),
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "put_secret",
      description: g(
        "Create or update a secret. Requires write scope (PAT) or OAuth member+. Never returns the value.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Secret name (e.g. GITHUB_TOKEN)" },
          value: { type: "string", description: "Secret plaintext (stored encrypted; never echoed)" },
          visibility: {
            type: "string",
            enum: ["private", "workspace"],
            description: "Default private",
          },
        },
        required: ["name", "value"],
        additionalProperties: false,
      },
    },
    {
      name: "delete_secret",
      description: g("Delete a secret by name. Requires write + member+."),
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Secret name to delete" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    {
      name: "upsert_upstream",
      description: g(
        "Create or update an upstream. Use {{secret:NAME}} in envTemplate. Requires write + admin. Reload MCP after.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          slug: { type: "string", description: "Lowercase slug used as tool namespace prefix (github → github__…)" },
          transport: { type: "string", enum: ["stdio", "http"] },
          command: { type: "string", description: "Required for stdio" },
          args: { type: "array", items: { type: "string" } },
          url: { type: "string", description: "Required for http" },
          envTemplate: {
            type: "object",
            additionalProperties: { type: "string" },
            description: 'Env map, e.g. { "TOKEN": "{{secret:GITHUB_TOKEN}}" }',
          },
          headersTemplate: {
            type: "object",
            additionalProperties: { type: "string" },
          },
          enabled: { type: "boolean" },
        },
        required: ["name", "slug", "transport"],
        additionalProperties: false,
      },
    },
    {
      name: "apply_integration",
      description: g(
        "Install a template (secrets + upstream). Requires write; secrets member+, upstream admin. Reload MCP after for slug__tools.",
      ),
      inputSchema: {
        type: "object",
        properties: {
          template_id: {
            type: "string",
            description: "Template id from list_templates (e.g. github, aws)",
          },
          secrets: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Map of secret NAME → value for slots the template needs",
          },
        },
        required: ["template_id"],
        additionalProperties: false,
      },
    },
  ];
}

async function listAggregatedTools(auth: GatewayAuth, workspaceId: string | null): Promise<Tool[]> {
  const tools = gatewayTools();
  if (!hasReadCapability(auth)) {
    return tools.filter((t) => t.name === "list_workspaces" || t.name === "current_workspace");
  }
  if (!workspaceId) return tools;

  const membership = await getMembership(workspaceId, auth.user.id);
  if (!membership || !canUseSecrets(membership.role)) {
    return tools;
  }

  const upstreams = (await listUpstreams(workspaceId, auth.user.id)).filter((u) => u.enabled);
  for (const up of upstreams) {
    let connected;
    try {
      connected = await connectUpstream(workspaceId, auth.user.id, up);
      const listed = await connected.client.listTools();
      for (const t of listed.tools) {
        const base = (t.description ?? "").trim();
        tools.push({
          ...t,
          name: namespaceTool(up.slug, t.name),
          // IDE UIs often show description as the call label — keep VaultMCP visible.
          description: `[VaultMCP → ${up.name}] ${base || t.name}`.trim(),
        });
      }
    } catch (err) {
      tools.push({
        name: namespaceTool(up.slug, "_unavailable"),
        description: `[VaultMCP → ${up.name}] Upstream unavailable: ${
          err instanceof Error ? err.message : String(err)
        }. Fix secrets/command on the host, then reload MCP.`,
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      });
    } finally {
      if (connected) await connected.close().catch(() => undefined);
    }
  }
  return tools;
}

async function notifyToolsChanged(server: Server) {
  try {
    await server.notification({ method: "notifications/tools/list_changed" });
  } catch {
    // Client may not support notifications yet (first handshake).
  }
}

function createMcpServer(auth: GatewayAuth): Server {
  const { user } = auth;
  const server = new Server(
    {
      // Protocol server name. Cursor maps mcp.json key "vaultmcp" → runtime id "user-vaultmcp".
      name: "vaultmcp",
      version: "0.1.0",
      title: "VaultMCP",
    },
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const state = await getSessionState(user);
    const tools = await listAggregatedTools(auth, state.workspaceId);
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const state = await getSessionState(user);

    try {
      if (name === "list_workspaces") {
        if (!hasReadCapability(auth)) {
          return errorResult("Token lacks read scope");
        }
        const list = await listWorkspacesForUser(user.id);
        return textResult(list);
      }

      if (name === "current_workspace") {
        if (!state.workspaceId) {
          return textResult("No workspace selected. Use use_workspace.");
        }
        const ws = await getWorkspaceById(state.workspaceId);
        return textResult(ws);
      }

      if (name === "use_workspace") {
        if (!hasReadCapability(auth)) {
          return errorResult("Token lacks read scope");
        }
        const workspaceId = (args as { workspace_id?: string; slug?: string })?.workspace_id;
        const slug = (args as { workspace_id?: string; slug?: string })?.slug;
        const workspaces = await listWorkspacesForUser(user.id);
        const target = workspaceId
          ? workspaces.find((w) => w.id === workspaceId)
          : workspaces.find((w) => w.slug === slug);
        if (!target) {
          await writeAudit({
            userId: user.id,
            action: "use_workspace",
            allowed: false,
            detail: { workspaceId, slug },
          });
          return errorResult("Workspace not found or not accessible");
        }
        await setSessionWorkspace(user.id, target.id);
        await writeAudit({
          workspaceId: target.id,
          userId: user.id,
          action: "use_workspace",
          allowed: true,
        });
        await notifyToolsChanged(server);
        return textResult({ ok: true, workspace: target });
      }

      if (name === "list_upstreams") {
        if (!hasReadCapability(auth)) {
          return errorResult("Token lacks read scope");
        }
        const { workspaceId } = await requireActiveWorkspace(auth, state, "viewer");
        const ups = await listUpstreams(workspaceId, user.id);
        const safe = ups.map((u) => ({
          id: u.id,
          name: u.name,
          slug: u.slug,
          transport: u.transport,
          enabled: u.enabled,
          requiredSecrets: u.requiredSecrets,
        }));
        return textResult(safe);
      }

      if (name === "list_secrets") {
        if (!hasReadCapability(auth)) {
          return errorResult("Token lacks read scope");
        }
        const { workspaceId } = await requireActiveWorkspace(auth, state, "viewer");
        const list = await secrets.listSecrets(workspaceId, user.id);
        const safe = list.map((s) => ({
          name: s.name,
          visibility: s.visibility,
          createdAt: s.createdAt,
        }));
        return textResult(safe);
      }

      if (name === "list_templates") {
        if (!hasReadCapability(auth)) {
          return errorResult("Token lacks read scope");
        }
        const catalog = INTEGRATION_TEMPLATES.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          custom: Boolean(t.custom),
          secrets: t.secrets.map((s) => ({
            name: s.name,
            visibility: s.visibility,
            hint: s.hint,
          })),
          upstream: t.upstream
            ? {
                name: t.upstream.name,
                slug: t.upstream.slug,
                transport: t.upstream.transport,
                command: t.upstream.command,
                args: t.upstream.args,
                url: t.upstream.url,
                envTemplate: t.upstream.envTemplate,
              }
            : null,
        }));
        return textResult(catalog);
      }

      if (name === "put_secret") {
        if (!hasWriteCapability(auth)) {
          return errorResult("Token lacks write scope — create a read-write PAT to store secrets");
        }
        const { workspaceId } = await requireActiveWorkspace(auth, state, "member");
        const body = CreateSecretSchema.parse({
          name: (args as { name?: string })?.name,
          value: (args as { value?: string })?.value,
          visibility: (args as { visibility?: SecretVisibility })?.visibility ?? "private",
          tags: [],
        });
        const meta = await secrets.putSecret(workspaceId, user.id, body);
        await writeAudit({
          workspaceId,
          userId: user.id,
          action: "put_secret",
          allowed: true,
          detail: { name: meta.name, visibility: meta.visibility },
        });
        return textResult({
          ok: true,
          secret: { name: meta.name, visibility: meta.visibility, createdAt: meta.createdAt },
        });
      }

      if (name === "delete_secret") {
        if (!hasWriteCapability(auth)) {
          return errorResult("Token lacks write scope");
        }
        const { workspaceId } = await requireActiveWorkspace(auth, state, "member");
        const secretName = (args as { name?: string })?.name;
        if (!secretName) return errorResult("name is required");
        await secrets.deleteSecretByName(workspaceId, user.id, secretName);
        await writeAudit({
          workspaceId,
          userId: user.id,
          action: "delete_secret",
          allowed: true,
          detail: { name: secretName },
        });
        return textResult({ ok: true, deleted: secretName });
      }

      if (name === "upsert_upstream") {
        if (!hasWriteCapability(auth)) {
          return errorResult("Token lacks write scope");
        }
        const { workspaceId, membership } = await requireActiveWorkspace(auth, state, "member");
        if (!canManageWorkspace(membership.role)) {
          return errorResult("Only workspace admins can register upstreams");
        }
        const body = CreateUpstreamSchema.parse({
          name: (args as { name?: string })?.name,
          slug: (args as { slug?: string })?.slug,
          transport: (args as { transport?: string })?.transport,
          command: (args as { command?: string })?.command,
          args: (args as { args?: string[] })?.args,
          url: (args as { url?: string })?.url,
          envTemplate: (args as { envTemplate?: Record<string, string> })?.envTemplate ?? {},
          headersTemplate:
            (args as { headersTemplate?: Record<string, string> })?.headersTemplate ?? {},
          enabled: (args as { enabled?: boolean })?.enabled ?? true,
        });
        const existing = await getUpstreamBySlug(workspaceId, body.slug);
        let upstream;
        if (existing) {
          upstream = await updateUpstream(workspaceId, user.id, existing.id, {
            name: body.name,
            command: body.command ?? null,
            args: body.args,
            url: body.url ?? null,
            envTemplate: body.envTemplate,
            headersTemplate: body.headersTemplate,
            enabled: body.enabled,
          });
        } else {
          upstream = await createUpstream(workspaceId, user.id, body);
        }
        await writeAudit({
          workspaceId,
          userId: user.id,
          action: "upsert_upstream",
          upstreamSlug: upstream.slug,
          allowed: true,
          detail: { updated: Boolean(existing) },
        });
        await notifyToolsChanged(server);
        return textResult({
          ok: true,
          upstream: {
            id: upstream.id,
            name: upstream.name,
            slug: upstream.slug,
            transport: upstream.transport,
            enabled: upstream.enabled,
            requiredSecrets: upstream.requiredSecrets,
          },
          hint: `Reload MCP tools to see ${upstream.slug}__* tools`,
        });
      }

      if (name === "apply_integration") {
        if (!hasWriteCapability(auth)) {
          return errorResult("Token lacks write scope");
        }
        const { workspaceId, membership } = await requireActiveWorkspace(auth, state, "member");
        const templateId = (args as { template_id?: string })?.template_id;
        const secretValues = (args as { secrets?: Record<string, string> })?.secrets ?? {};
        if (!templateId) return errorResult("template_id is required");
        const template = getIntegrationTemplate(templateId);
        if (!template) return errorResult(`Unknown template_id: ${templateId}`);
        if (template.custom || !template.upstream) {
          return errorResult(
            "Custom template cannot be applied via apply_integration — use put_secret and upsert_upstream",
          );
        }

        const existingSecrets = await secrets.listSecrets(workspaceId, user.id);
        const existingNames = new Set(existingSecrets.map((s) => s.name));
        const createdSecrets: string[] = [];

        for (const slot of template.secrets) {
          if (existingNames.has(slot.name)) continue;
          const value = (secretValues[slot.name] ?? "").trim();
          if (!value) {
            return errorResult(`Missing secret value for ${slot.name}`);
          }
          await secrets.putSecret(workspaceId, user.id, {
            name: slot.name,
            value,
            visibility: slot.visibility,
          });
          createdSecrets.push(slot.name);
        }

        const ups = await listUpstreams(workspaceId, user.id);
        const hasUpstream = ups.some((u) => u.slug === template.upstream!.slug);
        let upstreamCreated = false;
        if (!hasUpstream) {
          if (!canManageWorkspace(membership.role)) {
            return errorResult(
              "Secrets were stored, but only workspace admins can register the upstream. Ask an admin or use upsert_upstream.",
            );
          }
          await createUpstream(workspaceId, user.id, template.upstream);
          upstreamCreated = true;
        }

        await writeAudit({
          workspaceId,
          userId: user.id,
          action: "apply_integration",
          upstreamSlug: template.upstream.slug,
          allowed: true,
          detail: {
            template_id: template.id,
            createdSecrets,
            upstreamCreated,
          },
        });
        await notifyToolsChanged(server);
        return textResult({
          ok: true,
          template_id: template.id,
          createdSecrets,
          upstream: {
            slug: template.upstream.slug,
            created: upstreamCreated,
            alreadyPresent: hasUpstream,
          },
          hint: `Reload MCP tools to see ${template.upstream.slug}__* tools`,
        });
      }

      const parsed = parseNamespacedTool(name);
      if (!parsed) {
        return errorResult(`Unknown tool: ${name}`);
      }

      if (!hasReadCapability(auth)) {
        return errorResult("Token lacks read scope");
      }

      if (!state.workspaceId) {
        return errorResult("Select a workspace first with use_workspace");
      }

      const membership = await getMembership(state.workspaceId, user.id);
      if (!membership || !canUseSecrets(membership.role)) {
        await writeAudit({
          workspaceId: state.workspaceId,
          userId: user.id,
          action: "tools/call",
          upstreamSlug: parsed.serverSlug,
          toolName: parsed.toolName,
          allowed: false,
          detail: { reason: "insufficient_role" },
        });
        return errorResult("Viewers cannot invoke upstream tools that require secrets");
      }

      if (parsed.toolName === "_unavailable") {
        return errorResult("Upstream is unavailable");
      }

      const up = await getUpstreamBySlug(state.workspaceId, parsed.serverSlug);
      if (!up || !up.enabled) {
        await writeAudit({
          workspaceId: state.workspaceId,
          userId: user.id,
          action: "tools/call",
          upstreamSlug: parsed.serverSlug,
          toolName: parsed.toolName,
          allowed: false,
          detail: { reason: "upstream_not_found" },
        });
        return errorResult("Upstream not found");
      }

      let connected;
      try {
        connected = await connectUpstream(state.workspaceId, user.id, up);
        const result = await connected.client.callTool({
          name: parsed.toolName,
          arguments: (args as Record<string, unknown>) ?? {},
        });
        await writeAudit({
          workspaceId: state.workspaceId,
          userId: user.id,
          action: "tools/call",
          upstreamSlug: parsed.serverSlug,
          toolName: parsed.toolName,
          allowed: true,
        });
        return result;
      } catch (err) {
        await writeAudit({
          workspaceId: state.workspaceId,
          userId: user.id,
          action: "tools/call",
          upstreamSlug: parsed.serverSlug,
          toolName: parsed.toolName,
          allowed: false,
          detail: { error: err instanceof Error ? err.message : String(err) },
        });
        return errorResult(
          `Upstream call failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (connected) await connected.close().catch(() => undefined);
      }
    } catch (err) {
      if (err instanceof HttpError) {
        return errorResult(err.message);
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(message);
    }
  });

  return server;
}

/** In-memory transport sessions keyed by MCP-Session-Id */
const transports = new Map<string, StreamableHTTPServerTransport>();

export async function handleMcpRequest(req: Request, res: Response) {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const auth: GatewayAuth = {
    user,
    patScopes: req.patScopes as ApiTokenScope[] | undefined,
  };

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "POST" && !sessionId) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });
    const server = createMcpServer(auth);
    await server.connect(transport);
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) transports.delete(sid);
    };
    await transport.handleRequest(req, res, req.body);
    if (transport.sessionId) {
      transports.set(transport.sessionId, transport);
    }
    return;
  }

  if (!sessionId || !transports.has(sessionId)) {
    res.status(400).json({ error: "invalid_session", message: "Missing or unknown MCP-Session-Id" });
    return;
  }

  const transport = transports.get(sessionId)!;
  await transport.handleRequest(req, res, req.body);
}

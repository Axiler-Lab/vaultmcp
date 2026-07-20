import { findSecretPlaceholders, type UpstreamTransport } from "@vaultmcp/shared";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { auditLogs, upstreamServers } from "../db/schema.js";
import { HttpError, requireMembership } from "./workspaces.js";

export type UpstreamMeta = {
  id: string;
  name: string;
  slug: string;
  transport: UpstreamTransport;
  command: string | null;
  args: string[];
  url: string | null;
  envTemplate: Record<string, string>;
  headersTemplate: Record<string, string>;
  enabled: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  requiredSecrets: string[];
};

function collectRequiredSecrets(
  envTemplate: Record<string, string>,
  headersTemplate: Record<string, string>,
): string[] {
  const names = new Set<string>();
  for (const v of Object.values(envTemplate)) {
    for (const n of findSecretPlaceholders(v)) names.add(n);
  }
  for (const v of Object.values(headersTemplate)) {
    for (const n of findSecretPlaceholders(v)) names.add(n);
  }
  return [...names];
}

function toMeta(row: typeof upstreamServers.$inferSelect): UpstreamMeta {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    transport: row.transport,
    command: row.command,
    args: row.args,
    url: row.url,
    envTemplate: row.envTemplate,
    headersTemplate: row.headersTemplate,
    enabled: row.enabled,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    requiredSecrets: collectRequiredSecrets(row.envTemplate, row.headersTemplate),
  };
}

export async function listUpstreams(workspaceId: string, userId: string) {
  await requireMembership(workspaceId, userId, "viewer");
  const rows = await db
    .select()
    .from(upstreamServers)
    .where(eq(upstreamServers.workspaceId, workspaceId));
  return rows.map(toMeta);
}

export async function getUpstreamBySlug(workspaceId: string, slug: string) {
  const rows = await db
    .select()
    .from(upstreamServers)
    .where(and(eq(upstreamServers.workspaceId, workspaceId), eq(upstreamServers.slug, slug)))
    .limit(1);
  return rows[0] ? toMeta(rows[0]) : null;
}

export async function createUpstream(
  workspaceId: string,
  userId: string,
  input: {
    name: string;
    slug: string;
    transport: UpstreamTransport;
    command?: string;
    args?: string[];
    url?: string;
    envTemplate?: Record<string, string>;
    headersTemplate?: Record<string, string>;
    enabled?: boolean;
  },
) {
  await requireMembership(workspaceId, userId, "admin");
  if (input.transport === "stdio" && !input.command) {
    throw new HttpError(400, "command required for stdio transport");
  }
  if (input.transport === "http" && !input.url) {
    throw new HttpError(400, "url required for http transport");
  }
  try {
    const [row] = await db
      .insert(upstreamServers)
      .values({
        workspaceId,
        name: input.name,
        slug: input.slug,
        transport: input.transport,
        command: input.command ?? null,
        args: input.args ?? [],
        url: input.url ?? null,
        envTemplate: input.envTemplate ?? {},
        headersTemplate: input.headersTemplate ?? {},
        enabled: input.enabled ?? true,
        createdByUserId: userId,
      })
      .returning();
    return toMeta(row!);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "23505") throw new HttpError(409, "upstream slug already exists");
    throw err;
  }
}

export async function updateUpstream(
  workspaceId: string,
  userId: string,
  upstreamId: string,
  input: Partial<{
    name: string;
    command: string | null;
    args: string[];
    url: string | null;
    envTemplate: Record<string, string>;
    headersTemplate: Record<string, string>;
    enabled: boolean;
  }>,
) {
  await requireMembership(workspaceId, userId, "admin");
  const rows = await db
    .select()
    .from(upstreamServers)
    .where(and(eq(upstreamServers.id, upstreamId), eq(upstreamServers.workspaceId, workspaceId)))
    .limit(1);
  if (!rows[0]) throw new HttpError(404, "upstream not found");
  const [updated] = await db
    .update(upstreamServers)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(upstreamServers.id, upstreamId))
    .returning();
  return toMeta(updated!);
}

export async function deleteUpstream(workspaceId: string, userId: string, upstreamId: string) {
  await requireMembership(workspaceId, userId, "admin");
  await db
    .delete(upstreamServers)
    .where(and(eq(upstreamServers.id, upstreamId), eq(upstreamServers.workspaceId, workspaceId)));
}

export async function writeAudit(input: {
  workspaceId?: string | null;
  userId?: string | null;
  action: string;
  upstreamSlug?: string | null;
  toolName?: string | null;
  allowed: boolean;
  detail?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    workspaceId: input.workspaceId ?? null,
    userId: input.userId ?? null,
    action: input.action,
    upstreamSlug: input.upstreamSlug ?? null,
    toolName: input.toolName ?? null,
    allowed: input.allowed,
    detail: input.detail ?? {},
  });
}

export async function listAuditLogs(workspaceId: string, userId: string, limit = 100) {
  await requireMembership(workspaceId, userId, "admin");
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.workspaceId, workspaceId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(limit, 500));
}

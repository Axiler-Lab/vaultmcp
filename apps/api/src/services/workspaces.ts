import { and, eq, sql } from "drizzle-orm";
import type { WorkspaceRole } from "@vaultmcp/shared";
import { canManageWorkspace, canUseSecrets, roleAtLeast } from "@vaultmcp/shared";
import { db } from "../db/client.js";
import { users, workspaceMembers, workspaces } from "../db/schema.js";
import { mintWorkspaceDek } from "./workspace-keys.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getMembership(workspaceId: string, userId: string) {
  const rows = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function requireMembership(
  workspaceId: string,
  userId: string,
  minimum: WorkspaceRole = "viewer",
) {
  const m = await getMembership(workspaceId, userId);
  if (!m || !roleAtLeast(m.role, minimum)) {
    throw new HttpError(403, "forbidden");
  }
  return m;
}

export async function listWorkspacesForUser(userId: string) {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
      createdAt: workspaces.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId));
  return rows;
}

export async function createWorkspace(userId: string, name: string, slug: string) {
  const existing = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  if (existing[0]) throw new HttpError(409, "slug already taken");

  // Insert first to get id, then wrap DEK with workspaceId as AAD.
  const [ws] = await db
    .insert(workspaces)
    .values({ name, slug, createdByUserId: userId })
    .returning();
  const { wrappedDek } = mintWorkspaceDek(ws!.id);
  const [updated] = await db
    .update(workspaces)
    .set({ wrappedDek, updatedAt: new Date() })
    .where(eq(workspaces.id, ws!.id))
    .returning();
  await db.insert(workspaceMembers).values({
    workspaceId: ws!.id,
    userId,
    role: "owner",
  });
  return updated!;
}

export async function getWorkspaceById(id: string) {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getWorkspaceBySlug(slug: string) {
  const rows = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function listMembers(workspaceId: string) {
  return db
    .select({
      id: workspaceMembers.id,
      role: workspaceMembers.role,
      userId: users.id,
      githubLogin: users.githubLogin,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId));
}

export async function inviteMember(
  workspaceId: string,
  actorUserId: string,
  githubLogin: string,
  role: Exclude<WorkspaceRole, "owner">,
) {
  await requireMembership(workspaceId, actorUserId, "admin");
  const login = githubLogin.trim().replace(/^@+/, "").toLowerCase();
  if (!login) {
    throw new HttpError(400, "github username is required");
  }
  // GitHub logins are case-insensitive; match that way.
  const target = await db
    .select()
    .from(users)
    .where(sql`lower(${users.githubLogin}) = ${login}`)
    .limit(1);
  if (!target[0]) {
    throw new HttpError(
      400,
      `@${login} has not signed in to VaultMCP yet. Ask them to open vaultmcp.dev and Sign in with GitHub once, then invite again.`,
    );
  }
  const existing = await getMembership(workspaceId, target[0].id);
  if (existing) throw new HttpError(409, "already a member");

  const [row] = await db
    .insert(workspaceMembers)
    .values({
      workspaceId,
      userId: target[0].id,
      role,
    })
    .returning();
  return row!;
}

export async function updateMemberRole(
  workspaceId: string,
  actorUserId: string,
  memberId: string,
  role: Exclude<WorkspaceRole, "owner">,
) {
  await requireMembership(workspaceId, actorUserId, "admin");
  const members = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  const member = members[0];
  if (!member) throw new HttpError(404, "member not found");
  if (member.role === "owner") throw new HttpError(400, "cannot change owner role");

  const [updated] = await db
    .update(workspaceMembers)
    .set({ role })
    .where(eq(workspaceMembers.id, memberId))
    .returning();
  return updated!;
}

export async function removeMember(workspaceId: string, actorUserId: string, memberId: string) {
  await requireMembership(workspaceId, actorUserId, "admin");
  const members = await db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, workspaceId)))
    .limit(1);
  const member = members[0];
  if (!member) throw new HttpError(404, "member not found");
  if (member.role === "owner") throw new HttpError(400, "cannot remove owner");
  await db.delete(workspaceMembers).where(eq(workspaceMembers.id, memberId));
}

/** Owner-only. Cascades members/secrets/upstreams via FK; clears defaultWorkspaceId refs. */
export async function deleteWorkspace(workspaceId: string, actorUserId: string) {
  await requireMembership(workspaceId, actorUserId, "owner");
  const ws = await getWorkspaceById(workspaceId);
  if (!ws) throw new HttpError(404, "not_found");

  await db
    .update(users)
    .set({ defaultWorkspaceId: null, updatedAt: new Date() })
    .where(eq(users.defaultWorkspaceId, workspaceId));

  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
}

export { canManageWorkspace, canUseSecrets };

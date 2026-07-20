import type { SecretVisibility } from "@vaultmcp/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { secrets } from "../db/schema.js";
import { decryptSecretValue, encryptSecretValue } from "./workspace-keys.js";
import { HttpError, requireMembership } from "./workspaces.js";

export type SecretMeta = {
  id: string;
  name: string;
  visibility: SecretVisibility;
  tags: string[];
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

function toMeta(row: typeof secrets.$inferSelect): SecretMeta {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    tags: row.tags,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** List secret metadata visible to the user (never values). */
export async function listSecrets(workspaceId: string, userId: string): Promise<SecretMeta[]> {
  await requireMembership(workspaceId, userId, "viewer");
  const rows = await db.select().from(secrets).where(eq(secrets.workspaceId, workspaceId));
  return rows
    .filter((s) => s.visibility === "workspace" || s.createdByUserId === userId)
    .map(toMeta);
}

export async function createSecret(
  workspaceId: string,
  userId: string,
  input: {
    name: string;
    value: string;
    visibility: SecretVisibility;
    tags: string[];
  },
) {
  await requireMembership(workspaceId, userId, "member");
  const { ciphertext, cryptoVersion } = await encryptSecretValue(workspaceId, input.value);
  try {
    const [row] = await db
      .insert(secrets)
      .values({
        workspaceId,
        name: input.name,
        ciphertext,
        cryptoVersion,
        visibility: input.visibility,
        tags: input.tags,
        createdByUserId: userId,
      })
      .returning();
    return toMeta(row!);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === "23505") throw new HttpError(409, "secret name already exists");
    throw err;
  }
}

/** Create or update a secret by name (never returns the value). */
export async function putSecret(
  workspaceId: string,
  userId: string,
  input: {
    name: string;
    value: string;
    visibility?: SecretVisibility;
    tags?: string[];
  },
): Promise<SecretMeta> {
  await requireMembership(workspaceId, userId, "member");
  const rows = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.workspaceId, workspaceId), eq(secrets.name, input.name)))
    .limit(1);
  const existing = rows[0];
  if (!existing) {
    return createSecret(workspaceId, userId, {
      name: input.name,
      value: input.value,
      visibility: input.visibility ?? "private",
      tags: input.tags ?? [],
    });
  }
  return updateSecret(workspaceId, userId, existing.id, {
    value: input.value,
    visibility: input.visibility,
    tags: input.tags,
  });
}

export async function getSecretMetaByName(
  workspaceId: string,
  userId: string,
  name: string,
): Promise<SecretMeta | null> {
  const list = await listSecrets(workspaceId, userId);
  return list.find((s) => s.name === name) ?? null;
}

export async function updateSecret(
  workspaceId: string,
  userId: string,
  secretId: string,
  input: {
    value?: string;
    visibility?: SecretVisibility;
    tags?: string[];
  },
) {
  await requireMembership(workspaceId, userId, "member");
  const rows = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.workspaceId, workspaceId)))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new HttpError(404, "secret not found");
  if (existing.visibility === "private" && existing.createdByUserId !== userId) {
    throw new HttpError(403, "cannot modify another user's private secret");
  }
  // Only creator or admin can change workspace secrets
  if (existing.createdByUserId !== userId) {
    await requireMembership(workspaceId, userId, "admin");
  }

  let cipherPatch: { ciphertext: string; cryptoVersion: number } | undefined;
  if (input.value !== undefined) {
    cipherPatch = await encryptSecretValue(workspaceId, input.value);
  }

  const [updated] = await db
    .update(secrets)
    .set({
      ...(cipherPatch ?? {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      updatedAt: new Date(),
    })
    .where(eq(secrets.id, secretId))
    .returning();
  return toMeta(updated!);
}

export async function deleteSecret(workspaceId: string, userId: string, secretId: string) {
  await requireMembership(workspaceId, userId, "member");
  const rows = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.id, secretId), eq(secrets.workspaceId, workspaceId)))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new HttpError(404, "secret not found");
  if (existing.createdByUserId !== userId) {
    await requireMembership(workspaceId, userId, "admin");
  }
  await db.delete(secrets).where(eq(secrets.id, secretId));
}

export async function deleteSecretByName(workspaceId: string, userId: string, name: string) {
  await requireMembership(workspaceId, userId, "member");
  const rows = await db
    .select()
    .from(secrets)
    .where(and(eq(secrets.workspaceId, workspaceId), eq(secrets.name, name)))
    .limit(1);
  const existing = rows[0];
  if (!existing) throw new HttpError(404, "secret not found");
  await deleteSecret(workspaceId, userId, existing.id);
}

/**
 * Resolve decryptable secrets for injection for a given caller.
 * Private secrets only if caller created them; workspace secrets for member+.
 */
export async function resolveSecretsForInjection(
  workspaceId: string,
  userId: string,
  names: string[],
): Promise<Record<string, string>> {
  if (names.length === 0) return {};
  await requireMembership(workspaceId, userId, "member");
  const rows = await db.select().from(secrets).where(eq(secrets.workspaceId, workspaceId));
  const byName = new Map(rows.map((r) => [r.name, r]));
  const out: Record<string, string> = {};
  for (const name of names) {
    const row = byName.get(name);
    if (!row) throw new HttpError(400, `missing secret: ${name}`);
    const allowed =
      row.visibility === "workspace" ||
      (row.visibility === "private" && row.createdByUserId === userId);
    if (!allowed) throw new HttpError(403, `secret not accessible: ${name}`);
    out[name] = await decryptSecretValue(workspaceId, row.ciphertext, row.cryptoVersion);
  }
  return out;
}

/**
 * Resolve secrets for the runtime CLI export path.
 * Same visibility as injection; requires member+. Optional name filter.
 */
export async function resolveSecretsForRuntimeExport(
  workspaceId: string,
  userId: string,
  names?: string[],
): Promise<{ names: string[]; secrets: Record<string, string> }> {
  await requireMembership(workspaceId, userId, "member");
  const visible = await listSecrets(workspaceId, userId);
  const visibleNames = visible.map((s) => s.name);
  const target =
    names && names.length > 0
      ? names.map((n) => n.trim()).filter(Boolean)
      : visibleNames;
  for (const name of target) {
    if (!visibleNames.includes(name)) {
      throw new HttpError(403, `secret not accessible: ${name}`);
    }
  }
  const secretsMap = await resolveSecretsForInjection(workspaceId, userId, target);
  return { names: target, secrets: secretsMap };
}

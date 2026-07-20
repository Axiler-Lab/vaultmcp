import {
  CRYPTO_VERSION_ENVELOPE,
  CRYPTO_VERSION_LEGACY,
  decryptSecret,
  decryptWithDek,
  encryptWithDek,
  generateDek,
  unwrapDek,
  wrapDek,
} from "@vaultmcp/shared/crypto";
import { eq, isNull } from "drizzle-orm";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { secrets, workspaces } from "../db/schema.js";

/** Process-local DEK cache (cleared on restart). Never persisted. */
const dekCache = new Map<string, Buffer>();

export function clearDekCache(): void {
  dekCache.clear();
}

/** Mint a new DEK and return plaintext + wrapped form for storage. */
export function mintWorkspaceDek(workspaceId: string): { dek: Buffer; wrappedDek: string } {
  const dek = generateDek();
  const wrappedDek = wrapDek(dek, env.masterKey, workspaceId);
  return { dek, wrappedDek };
}

/**
 * Load (or mint) the workspace DEK. Ensures wrapped_dek is persisted.
 */
export async function getWorkspaceDek(workspaceId: string): Promise<Buffer> {
  const cached = dekCache.get(workspaceId);
  if (cached) return cached;

  const rows = await db
    .select({ id: workspaces.id, wrappedDek: workspaces.wrappedDek })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error(`workspace not found: ${workspaceId}`);
  }

  let dek: Buffer;
  if (row.wrappedDek) {
    dek = unwrapDek(row.wrappedDek, env.masterKey, workspaceId);
  } else {
    const minted = mintWorkspaceDek(workspaceId);
    dek = minted.dek;
    await db
      .update(workspaces)
      .set({ wrappedDek: minted.wrappedDek, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId));
  }

  dekCache.set(workspaceId, dek);
  return dek;
}

export async function encryptSecretValue(
  workspaceId: string,
  plaintext: string,
): Promise<{ ciphertext: string; cryptoVersion: number }> {
  const dek = await getWorkspaceDek(workspaceId);
  return {
    ciphertext: encryptWithDek(plaintext, dek, workspaceId),
    cryptoVersion: CRYPTO_VERSION_ENVELOPE,
  };
}

export async function decryptSecretValue(
  workspaceId: string,
  ciphertext: string,
  cryptoVersion: number,
): Promise<string> {
  if (cryptoVersion === CRYPTO_VERSION_LEGACY) {
    return decryptSecret(ciphertext, env.masterKey);
  }
  if (cryptoVersion === CRYPTO_VERSION_ENVELOPE) {
    const dek = await getWorkspaceDek(workspaceId);
    return decryptWithDek(ciphertext, dek, workspaceId);
  }
  throw new Error(`unsupported crypto_version: ${cryptoVersion}`);
}

/**
 * Ensure every workspace has a wrapped DEK, and re-encrypt legacy secrets to envelope.
 * Safe to run repeatedly. Called after schema migrations.
 */
export async function backfillEnvelopeCrypto(): Promise<{
  workspacesMinted: number;
  secretsUpgraded: number;
}> {
  let workspacesMinted = 0;
  let secretsUpgraded = 0;

  const missingDek = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(isNull(workspaces.wrappedDek));

  for (const ws of missingDek) {
    const { dek, wrappedDek } = mintWorkspaceDek(ws.id);
    await db
      .update(workspaces)
      .set({ wrappedDek, updatedAt: new Date() })
      .where(eq(workspaces.id, ws.id));
    dekCache.set(ws.id, dek);
    workspacesMinted++;
  }

  const legacy = await db
    .select({
      id: secrets.id,
      workspaceId: secrets.workspaceId,
      ciphertext: secrets.ciphertext,
      cryptoVersion: secrets.cryptoVersion,
    })
    .from(secrets)
    .where(eq(secrets.cryptoVersion, CRYPTO_VERSION_LEGACY));

  for (const row of legacy) {
    const plain = decryptSecret(row.ciphertext, env.masterKey);
    const dek = await getWorkspaceDek(row.workspaceId);
    const ciphertext = encryptWithDek(plain, dek, row.workspaceId);
    await db
      .update(secrets)
      .set({
        ciphertext,
        cryptoVersion: CRYPTO_VERSION_ENVELOPE,
        updatedAt: new Date(),
      })
      .where(eq(secrets.id, row.id));
    secretsUpgraded++;
  }

  return { workspacesMinted, secretsUpgraded };
}

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/** Legacy: secret values encrypted directly with the KEK (master key), no AAD. */
export const CRYPTO_VERSION_LEGACY = 1;
/** Envelope: per-workspace DEK + GCM AAD bound to workspaceId. */
export const CRYPTO_VERSION_ENVELOPE = 2;

export function deriveMasterKey(masterKeyMaterial: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(masterKeyMaterial)) {
    return Buffer.from(masterKeyMaterial, "hex");
  }
  return scryptSync(masterKeyMaterial, "vaultmcp-v1", KEY_LENGTH);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Wire format: base64(iv || authTag || ciphertext)
 * Optional AAD binds ciphertext to a context (e.g. workspaceId).
 */
export function encryptSecret(plaintext: string, key: Buffer, aad?: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad, "utf8"));
  }
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(payload: string, key: Buffer, aad?: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid ciphertext");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  if (aad !== undefined) {
    decipher.setAAD(Buffer.from(aad, "utf8"));
  }
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Random 32-byte data encryption key for a workspace. */
export function generateDek(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Wrap a DEK with the KEK (master key), AAD-bound to workspaceId.
 * Stored as workspaces.wrapped_dek.
 */
export function wrapDek(dek: Buffer, kek: Buffer, workspaceId: string): string {
  if (dek.length !== KEY_LENGTH) {
    throw new Error("DEK must be 32 bytes");
  }
  return encryptSecret(dek.toString("base64"), kek, `dek:${workspaceId}`);
}

export function unwrapDek(wrapped: string, kek: Buffer, workspaceId: string): Buffer {
  const b64 = decryptSecret(wrapped, kek, `dek:${workspaceId}`);
  const dek = Buffer.from(b64, "base64");
  if (dek.length !== KEY_LENGTH) {
    throw new Error("Invalid unwrapped DEK length");
  }
  return dek;
}

/** Encrypt a secret value with a workspace DEK (envelope crypto). */
export function encryptWithDek(plaintext: string, dek: Buffer, workspaceId: string): string {
  return encryptSecret(plaintext, dek, workspaceId);
}

/** Decrypt a secret value encrypted with a workspace DEK. */
export function decryptWithDek(payload: string, dek: Buffer, workspaceId: string): string {
  return decryptSecret(payload, dek, workspaceId);
}

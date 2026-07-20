import { encryptSecret, decryptSecret } from "@vaultmcp/shared/crypto";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { env } from "../config.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { HttpError } from "./workspaces.js";

function totpAad(userId: string): string {
  return `totp:${userId}`;
}

export async function getUserMfaState(userId: string) {
  const rows = await db
    .select({
      totpEnabled: users.totpEnabled,
      totpSecretCiphertext: users.totpSecretCiphertext,
      githubLogin: users.githubLogin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

function decryptTotpSecret(userId: string, ciphertext: string): string {
  return decryptSecret(ciphertext, env.masterKey, totpAad(userId));
}

export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const trimmed = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) return false;
  const totp = new OTPAuth.TOTP({
    issuer: "VaultMCP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token: trimmed, window: 1 });
  return delta !== null;
}

/** Begin MFA setup: stores encrypted secret (not enabled until confirm). */
export async function beginTotpSetup(userId: string, githubLogin: string) {
  const state = await getUserMfaState(userId);
  if (!state) throw new HttpError(404, "user not found");
  if (state.totpEnabled) throw new HttpError(409, "mfa already enabled");

  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: "VaultMCP",
    label: githubLogin,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  });
  const ciphertext = encryptSecret(secret.base32, env.masterKey, totpAad(userId));
  await db
    .update(users)
    .set({
      totpSecretCiphertext: ciphertext,
      totpEnabled: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));

  return {
    secret: secret.base32,
    otpauthUrl: totp.toString(),
  };
}

/** Confirm setup with a valid code → enable MFA. */
export async function confirmTotpSetup(userId: string, code: string) {
  const state = await getUserMfaState(userId);
  if (!state?.totpSecretCiphertext) throw new HttpError(400, "mfa setup not started");
  if (state.totpEnabled) throw new HttpError(409, "mfa already enabled");
  const secret = decryptTotpSecret(userId, state.totpSecretCiphertext);
  if (!verifyTotpCode(secret, code)) throw new HttpError(401, "invalid code");
  await db
    .update(users)
    .set({ totpEnabled: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

export async function disableTotp(userId: string, code: string) {
  const state = await getUserMfaState(userId);
  if (!state?.totpEnabled || !state.totpSecretCiphertext) {
    throw new HttpError(400, "mfa not enabled");
  }
  const secret = decryptTotpSecret(userId, state.totpSecretCiphertext);
  if (!verifyTotpCode(secret, code)) throw new HttpError(401, "invalid code");
  await db
    .update(users)
    .set({
      totpEnabled: false,
      totpSecretCiphertext: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId));
}

export async function checkTotpForUser(userId: string, code: string): Promise<boolean> {
  const state = await getUserMfaState(userId);
  if (!state?.totpEnabled || !state.totpSecretCiphertext) return false;
  const secret = decryptTotpSecret(userId, state.totpSecretCiphertext);
  return verifyTotpCode(secret, code);
}

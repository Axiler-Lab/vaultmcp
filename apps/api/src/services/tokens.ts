import { and, desc, eq, isNull } from "drizzle-orm";
import {
  API_TOKEN_PREFIX,
  DEFAULT_API_TOKEN_EXPIRY_DAYS,
  DEFAULT_API_TOKEN_SCOPES,
  type ApiTokenScope,
} from "@vaultmcp/shared";
import { db } from "../db/client.js";
import { apiTokens } from "../db/schema.js";
import { randomToken, sha256 } from "../util/crypto.js";
import { HttpError } from "./workspaces.js";

const PREFIX_DISPLAY_LEN = 12;

export function isApiToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

export type ApiTokenListItem = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: ApiTokenScope[];
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type CreateTokenInput = {
  name: string;
  scopes?: ApiTokenScope[];
  expiresInDays?: number;
  expiresAt?: string;
};

function normalizeScopes(scopes?: ApiTokenScope[]): ApiTokenScope[] {
  if (!scopes || scopes.length === 0) return [...DEFAULT_API_TOKEN_SCOPES];
  const unique = [...new Set(scopes)];
  if (unique.includes("write") && !unique.includes("read")) {
    throw new HttpError(400, "write scope requires read");
  }
  if (!unique.includes("read") && !unique.includes("env")) {
    throw new HttpError(400, "scopes must include read and/or env");
  }
  return unique;
}

function resolveExpiresAt(input: CreateTokenInput): Date {
  if (input.expiresAt) {
    const at = new Date(input.expiresAt);
    if (Number.isNaN(at.getTime())) throw new HttpError(400, "invalid expiresAt");
    if (at.getTime() <= Date.now()) throw new HttpError(400, "expiresAt must be in the future");
    return at;
  }
  const days = input.expiresInDays ?? DEFAULT_API_TOKEN_EXPIRY_DAYS;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function toListItem(row: {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}): ApiTokenListItem {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes as ApiTokenScope[],
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function listTokens(userId: string): Promise<ApiTokenListItem[]> {
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(toListItem);
}

/** Create a PAT. Returns plaintext once; only the hash is stored. */
export async function createToken(
  userId: string,
  input: CreateTokenInput,
): Promise<ApiTokenListItem & { token: string }> {
  const token = `${API_TOKEN_PREFIX}${randomToken(32)}`;
  const tokenPrefix = token.slice(0, PREFIX_DISPLAY_LEN);
  const scopes = normalizeScopes(input.scopes);
  const expiresAt = resolveExpiresAt(input);
  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: input.name,
      tokenHash: sha256(token),
      tokenPrefix,
      scopes,
      expiresAt,
    })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      tokenPrefix: apiTokens.tokenPrefix,
      scopes: apiTokens.scopes,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    });
  if (!row) throw new HttpError(500, "internal_error");
  return { ...toListItem(row), token };
}

export async function revokeToken(userId: string, tokenId: string) {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(
      and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)),
    )
    .limit(1);
  if (!rows[0]) throw new HttpError(404, "not_found");
  await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(eq(apiTokens.id, tokenId));
}

export type ApiTokenAuthResult =
  | { ok: true; userId: string; scopes: ApiTokenScope[]; tokenPrefix: string; tokenId: string }
  | { ok: false; reason: "invalid" | "expired" };

/** Resolve an active PAT, reject expired, bump last_used_at. */
export async function authenticateApiToken(token: string): Promise<ApiTokenAuthResult> {
  if (!isApiToken(token)) return { ok: false, reason: "invalid" };
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, sha256(token)), isNull(apiTokens.revokedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) return { ok: false, reason: "invalid" };
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, row.id));
  return {
    ok: true,
    userId: row.userId,
    tokenId: row.id,
    tokenPrefix: row.tokenPrefix,
    scopes: (row.scopes?.length ? row.scopes : DEFAULT_API_TOKEN_SCOPES) as ApiTokenScope[],
  };
}

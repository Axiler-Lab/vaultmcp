import { createHash } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import type { Request, Response, NextFunction, Router } from "express";
import { Router as createRouter } from "express";
import { db } from "../db/client.js";
import {
  oauthAccessTokens,
  oauthAuthCodes,
  oauthClients,
  oauthRefreshTokens,
} from "../db/schema.js";
import { env } from "../config.js";
import { getUserById, optionalWebAuth, requireWebAuth } from "./session.js";
import { authenticateApiToken, isApiToken } from "../services/tokens.js";
import { filterOAuthRedirectUris, isAllowedOAuthRedirect } from "@vaultmcp/shared";
import { randomToken, sha256, safeEqualStr } from "../util/crypto.js";

const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function isAllowedRedirect(uri: string): boolean {
  return isAllowedOAuthRedirect(uri);
}

export const mcpOauthRouter: Router = createRouter();

function protectedResourceMetadata() {
  return {
    resource: `${env.PUBLIC_URL}/mcp`,
    authorization_servers: [env.PUBLIC_URL],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  };
}

/** Protected Resource Metadata (RFC 9728) — root and path-appended forms */
mcpOauthRouter.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json(protectedResourceMetadata());
});

mcpOauthRouter.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
  res.json(protectedResourceMetadata());
});

mcpOauthRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: env.PUBLIC_URL,
    authorization_endpoint: `${env.PUBLIC_URL}/oauth/authorize`,
    token_endpoint: `${env.PUBLIC_URL}/oauth/token`,
    registration_endpoint: `${env.PUBLIC_URL}/oauth/register`,
    revocation_endpoint: `${env.PUBLIC_URL}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    scopes_supported: ["mcp"],
  });
});

/** Dynamic Client Registration (RFC 7591) — simplified */
mcpOauthRouter.post("/oauth/register", async (req, res) => {
  const body = req.body as {
    client_name?: string;
    redirect_uris?: string[];
    grant_types?: string[];
    token_endpoint_auth_method?: string;
  };
  const rawUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  let redirectUris: string[];
  try {
    redirectUris = filterOAuthRedirectUris(rawUris);
  } catch (err) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: err instanceof Error ? err.message : "redirect_uris required",
    });
    return;
  }
  const clientId = `vmcp_${randomToken(16)}`;
  await db.insert(oauthClients).values({
    clientId,
    clientName: body.client_name ?? "MCP Client",
    redirectUris,
    grantTypes: body.grant_types ?? ["authorization_code", "refresh_token"],
    tokenEndpointAuthMethod: body.token_endpoint_auth_method ?? "none",
  });
  res.status(201).json({
    client_id: clientId,
    client_name: body.client_name ?? "MCP Client",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: body.token_endpoint_auth_method ?? "none",
    client_id_issued_at: Math.floor(Date.now() / 1000),
  });
});

mcpOauthRouter.get("/oauth/authorize", optionalWebAuth, async (req, res) => {
  const clientId = String(req.query.client_id ?? "");
  const redirectUri = String(req.query.redirect_uri ?? "");
  const responseType = String(req.query.response_type ?? "");
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const codeChallenge = String(req.query.code_challenge ?? "");
  const codeChallengeMethod = String(req.query.code_challenge_method ?? "S256");
  const scope = typeof req.query.scope === "string" ? req.query.scope : "mcp";

  if (responseType !== "code") {
    res.status(400).send("unsupported response_type");
    return;
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    res.status(400).send("missing required parameters");
    return;
  }
  if (codeChallengeMethod !== "S256") {
    res.status(400).send("code_challenge_method must be S256");
    return;
  }

  const existing = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!isAllowedRedirect(redirectUri)) {
    res.status(400).send("invalid redirect_uri");
    return;
  }
  if (!existing[0]) {
    // Auto-register loopback / native clients only (Cursor, VS Code, etc.)
    await db.insert(oauthClients).values({
      clientId,
      clientName: "MCP Client",
      redirectUris: [redirectUri],
      tokenEndpointAuthMethod: "none",
    });
  } else if (!existing[0].redirectUris.includes(redirectUri)) {
    const updated = [...new Set([...existing[0].redirectUris, redirectUri])];
    await db.update(oauthClients).set({ redirectUris: updated }).where(eq(oauthClients.clientId, clientId));
  }

  if (!req.user || (req.user.totpEnabled && !req.mfaSatisfied)) {
    const returnTo = `${env.PUBLIC_URL}/oauth/authorize?${new URLSearchParams(req.query as Record<string, string>)}`;
    res.redirect(`${env.PUBLIC_URL}/auth/github?returnTo=${encodeURIComponent(returnTo)}`);
    return;
  }

  // Consent page — auto-approve for logged-in user (v1)
  const code = randomToken(24);
  await db.insert(oauthAuthCodes).values({
    codeHash: sha256(code),
    clientId,
    userId: req.user.id,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    scope,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", state);
  res.redirect(redirect.toString());
});

mcpOauthRouter.post("/oauth/token", async (req, res) => {
  const body = req.body as Record<string, string>;
  const grantType = body.grant_type;

  if (grantType === "authorization_code") {
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const clientId = body.client_id;
    const codeVerifier = body.code_verifier;
    if (!code || !redirectUri || !clientId || !codeVerifier) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }

    const consumed = await db
      .delete(oauthAuthCodes)
      .where(
        and(
          eq(oauthAuthCodes.codeHash, sha256(code)),
          gt(oauthAuthCodes.expiresAt, new Date()),
        ),
      )
      .returning();
    const authCode = consumed[0];
    if (!authCode || authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    if (!safeEqualStr(pkceChallenge(codeVerifier), authCode.codeChallenge)) {
      res.status(400).json({ error: "invalid_grant", error_description: "pkce verification failed" });
      return;
    }

    const accessToken = randomToken(32);
    const refreshToken = randomToken(32);
    await db.insert(oauthAccessTokens).values({
      tokenHash: sha256(accessToken),
      clientId,
      userId: authCode.userId,
      scope: authCode.scope,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    });
    await db.insert(oauthRefreshTokens).values({
      tokenHash: sha256(refreshToken),
      clientId,
      userId: authCode.userId,
      scope: authCode.scope,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
      scope: authCode.scope ?? "mcp",
    });
    return;
  }

  if (grantType === "refresh_token") {
    const refreshToken = body.refresh_token;
    const clientId = body.client_id;
    if (!refreshToken || !clientId) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const rows = await db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.tokenHash, sha256(refreshToken)),
          eq(oauthRefreshTokens.revoked, false),
          gt(oauthRefreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);
    const rt = rows[0];
    if (!rt || rt.clientId !== clientId) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    const accessToken = randomToken(32);
    const nextRefresh = randomToken(32);
    await db
      .update(oauthRefreshTokens)
      .set({ revoked: true })
      .where(eq(oauthRefreshTokens.id, rt.id));
    await db.insert(oauthAccessTokens).values({
      tokenHash: sha256(accessToken),
      clientId,
      userId: rt.userId,
      scope: rt.scope,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    });
    await db.insert(oauthRefreshTokens).values({
      tokenHash: sha256(nextRefresh),
      clientId,
      userId: rt.userId,
      scope: rt.scope,
      expiresAt: rt.expiresAt,
    });

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: nextRefresh,
      scope: rt.scope ?? "mcp",
    });
    return;
  }

  res.status(400).json({ error: "unsupported_grant_type" });
});

mcpOauthRouter.post("/oauth/revoke", async (req, res) => {
  const token = (req.body as { token?: string }).token;
  if (token) {
    await db
      .update(oauthRefreshTokens)
      .set({ revoked: true })
      .where(eq(oauthRefreshTokens.tokenHash, sha256(token)));
    await db.delete(oauthAccessTokens).where(eq(oauthAccessTokens.tokenHash, sha256(token)));
  }
  res.status(200).json({ ok: true });
});

export async function requireMcpBearer(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer FAKESECRET_g3h4i5j6k7l8m9n0o1p2="${env.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp", scope="mcp"`,
    );
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const token = header.slice("Bearer ".length).trim();

  // Personal access tokens (dashboard) — `vmcp_…`
  if (isApiToken(token)) {
    const auth = await authenticateApiToken(token);
    if (!auth.ok) {
      if (auth.reason === "expired") {
        res.setHeader(
          "WWW-Authenticate",
          `Bearer error="invalid_token", error_description="Personal access token has expired"`,
        );
        res.status(401).json({
          error: "token_expired",
          message: "Personal access token has expired",
        });
        return;
      }
      res.status(401).json({ error: "invalid_token" });
      return;
    }
    const user = await getUserById(auth.userId);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.user = user;
    req.accessTokenScope = "mcp";
    req.patScopes = auth.scopes;
    next();
    return;
  }

  // OAuth access tokens issued by /oauth/token
  const rows = await db
    .select()
    .from(oauthAccessTokens)
    .where(
      and(eq(oauthAccessTokens.tokenHash, sha256(token)), gt(oauthAccessTokens.expiresAt, new Date())),
    )
    .limit(1);
  const at = rows[0];
  if (!at) {
    res.setHeader(
      "WWW-Authenticate",
      `Bearer FAKESECRET_k2l3m4n5o6p7q8r9s0t1="${env.PUBLIC_URL}/.well-known/oauth-protected-resource/mcp"`,
    );
    res.status(401).json({ error: "invalid_token" });
    return;
  }
  const user = await getUserById(at.userId);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  req.user = user;
  req.accessTokenScope = at.scope;
  next();
}

export { requireWebAuth };

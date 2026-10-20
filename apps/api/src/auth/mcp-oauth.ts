import { createHash, timingSafeEqual } from "node:crypto";
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

const CONSENT_COOKIE = "vaultmcp_oauth_consent";
const CONSENT_TTL_MS = 10 * 60 * 1000;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function safeHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return uri;
  }
}

type AuthorizeParams = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
};

/** Shared extraction + validation for GET/POST /oauth/authorize. */
function readAuthorizeParams(
  source: Record<string, unknown>,
): AuthorizeParams | "bad_response_type" | "missing" | "bad_method" {
  const clientId = String(source.client_id ?? "");
  const redirectUri = String(source.redirect_uri ?? "");
  const responseType = String(source.response_type ?? "");
  const state = typeof source.state === "string" ? source.state : undefined;
  const codeChallenge = String(source.code_challenge ?? "");
  const codeChallengeMethod = String(source.code_challenge_method ?? "S256");
  const scope = typeof source.scope === "string" ? source.scope : "mcp";
  if (responseType !== "code") return "bad_response_type";
  if (!clientId || !redirectUri || !codeChallenge) return "missing";
  if (codeChallengeMethod !== "S256") return "bad_method";
  return { clientId, redirectUri, responseType, state, codeChallenge, codeChallengeMethod, scope };
}

function authorizeParamError(res: Response, err: "bad_response_type" | "missing" | "bad_method") {
  if (err === "bad_response_type") res.status(400).send("unsupported response_type");
  else if (err === "bad_method") res.status(400).send("code_challenge_method must be S256");
  else res.status(400).send("missing required parameters");
}

async function resolveClient(clientId: string, redirectUri: string) {
  if (!isAllowedRedirect(redirectUri)) {
    return null;
  }
  const existing = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
  if (!existing[0]) {
    // Auto-register loopback / native clients only (Cursor, VS Code, etc.)
    await db.insert(oauthClients).values({
      clientId,
      clientName: "MCP Client",
      redirectUris: [redirectUri],
      tokenEndpointAuthMethod: "none",
    });
    return { clientName: "MCP Client" as const };
  }
  if (!existing[0].redirectUris.includes(redirectUri)) {
    const updated = [...new Set([...existing[0].redirectUris, redirectUri])];
    await db.update(oauthClients).set({ redirectUris: updated }).where(eq(oauthClients.clientId, clientId));
  }
  return existing[0];
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>) {
  const redirect = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) redirect.searchParams.set(k, v);
  }
  return redirect.toString();
}

mcpOauthRouter.get("/oauth/authorize", optionalWebAuth, async (req, res) => {
  const params = readAuthorizeParams(req.query as Record<string, unknown>);
  if (typeof params === "string") {
    authorizeParamError(res, params);
    return;
  }

  const client = await resolveClient(params.clientId, params.redirectUri);
  if (!client) {
    res.status(400).send("invalid redirect_uri");
    return;
  }

  if (!req.user || (req.user.totpEnabled && !req.mfaSatisfied)) {
    const returnTo = `${env.PUBLIC_URL}/oauth/authorize?${new URLSearchParams(req.query as Record<string, string>)}`;
    res.redirect(`${env.PUBLIC_URL}/auth/github?returnTo=${encodeURIComponent(returnTo)}`);
    return;
  }

  // Consent screen: the code is minted only on explicit approval (POST below).
  const csrf = randomToken(24);
  res.cookie(CONSENT_COOKIE, csrf, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    maxAge: CONSENT_TTL_MS,
    path: "/oauth",
  });
  const fields: Record<string, string> = {
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: params.responseType,
    code_challenge: params.codeChallenge,
    code_challenge_method: params.codeChallengeMethod,
    scope: params.scope,
    csrf,
  };
  if (params.state) fields.state = params.state;
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("\n          ");
  const clientName = escapeHtml(client.clientName ?? params.clientId);
  const host = escapeHtml(safeHost(params.redirectUri));
  res.status(200).type("html").send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Authorize ${clientName} — VaultMCP</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0a0a0a; color: #f5f5f5;
             display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
      .card { background: #141414; border: 1px solid #2a2a2a; border-radius: 12px; padding: 28px;
              max-width: 420px; width: 90%; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { color: #a3a3a3; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
      code { color: #e5e5e5; background: #1f1f1f; padding: 2px 6px; border-radius: 4px; }
      .actions { display: flex; gap: 10px; }
      button { flex: 1; padding: 10px 0; border-radius: 8px; border: 1px solid #2a2a2a; font-size: 14px;
               cursor: pointer; }
      .approve { background: #f5f5f5; color: #0a0a0a; border: none; font-weight: 600; }
      .deny { background: transparent; color: #f5f5f5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Authorize ${clientName}?</h1>
      <p>This MCP client is asking to access your VaultMCP workspaces. It will redirect to
         <code>${host}</code> after approval. Approve only if you started this connection
         from your MCP client.</p>
      <form method="post" action="/oauth/authorize">
          ${inputs}
        <div class="actions">
          <button class="deny" type="submit" name="action" value="deny">Deny</button>
          <button class="approve" type="submit" name="action" value="approve">Authorize</button>
        </div>
      </form>
    </div>
  </body>
</html>`);
});

mcpOauthRouter.post("/oauth/authorize", optionalWebAuth, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (!req.user || (req.user.totpEnabled && !req.mfaSatisfied)) {
    const returnTo = `${env.PUBLIC_URL}/oauth/authorize?${new URLSearchParams(body as Record<string, string>)}`;
    res.redirect(`${env.PUBLIC_URL}/auth/github?returnTo=${encodeURIComponent(returnTo)}`);
    return;
  }

  const cookieToken = (req.cookies?.[CONSENT_COOKIE] ?? "") as string;
  const formToken = String(body.csrf ?? "");
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(formToken);
  if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) {
    res.status(400).send("invalid or expired consent request");
    return;
  }

  const params = readAuthorizeParams(body);
  if (typeof params === "string") {
    authorizeParamError(res, params);
    return;
  }
  const client = await resolveClient(params.clientId, params.redirectUri);
  if (!client) {
    res.status(400).send("invalid redirect_uri");
    return;
  }

  res.clearCookie(CONSENT_COOKIE, { path: "/oauth" });

  if (String(body.action ?? "") !== "approve") {
    res.redirect(redirectWith(params.redirectUri, { error: "access_denied", state: params.state }));
    return;
  }

  const code = randomToken(24);
  await db.insert(oauthAuthCodes).values({
    codeHash: sha256(code),
    clientId: params.clientId,
    userId: req.user.id,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    scope: params.scope,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
  });
  res.redirect(redirectWith(params.redirectUri, { code, state: params.state }));
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

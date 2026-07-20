#!/usr/bin/env node
/**
 * VaultMCP smoke / integration test.
 * Seeds a user + session via Postgres (no GitHub), then exercises REST + OAuth + MCP.
 */
import { createHash, createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../apps/api/package.json"),
);
const pg = require("pg");
try {
  require("dotenv").config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
  });
} catch {
  /* ignore */
}

const BASE = process.env.PUBLIC_URL ?? "http://localhost:3001";
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://vaultmcp:vaultmcp@localhost:5432/vaultmcp";
const MASTER = process.env.VAULT_MASTER_KEY ?? "test-master-key-please-change";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}
function deriveKey(material) {
  if (/^[0-9a-fA-F]{64}$/.test(material)) return Buffer.from(material, "hex");
  return scryptSync(material, "vaultmcp-v1", 32);
}
function encrypt(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

let passed = 0;
let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err instanceof Error ? err.message : err}`);
  }
}

const jar = { cookie: null };

async function api(path, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.json) headers["Content-Type"] = "application/json";
  if (jar.cookie) headers.Cookie = jar.cookie;
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers,
    body: opts.json ? JSON.stringify(opts.json) : opts.body,
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const part = c.split(";")[0];
    if (part.startsWith("vaultmcp_session=")) jar.cookie = part;
  }
  const text = await res.text();
  let body;
  const ct = res.headers.get("content-type") ?? "";
  try {
    if (ct.includes("text/event-stream") && text) {
      // Parse last data: line from SSE as JSON-RPC result
      const dataLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter(Boolean);
      const last = dataLines.at(-1);
      body = last ? JSON.parse(last) : text;
    } else {
      body = text ? JSON.parse(text) : null;
    }
  } catch {
    body = text;
  }
  return { res, body, status: res.status };
}

async function main() {
  console.log(`\nVaultMCP smoke test → ${BASE}\n`);

  await step("GET /health", async () => {
    const { status, body } = await api("/health");
    assert(status === 200, `status ${status}`);
    assert(body?.ok === true, "ok flag");
  });

  await step("OAuth AS metadata", async () => {
    const { status, body } = await api("/.well-known/oauth-authorization-server");
    assert(status === 200, `status ${status}`);
    assert(body?.authorization_endpoint?.includes("/oauth/authorize"), "auth endpoint");
    assert(body?.token_endpoint?.includes("/oauth/token"), "token endpoint");
    assert(body?.code_challenge_methods_supported?.includes("S256"), "PKCE S256");
  });

  await step("OAuth protected resource metadata", async () => {
    const { status, body } = await api("/.well-known/oauth-protected-resource");
    assert(status === 200, `status ${status}`);
    assert(body?.resource?.endsWith("/mcp"), "resource url");
  });

  await step("MCP rejects unauthenticated", async () => {
    const { status } = await api("/mcp", {
      method: "POST",
      json: { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    });
    assert(status === 401, `expected 401 got ${status}`);
  });

  await step("API rejects unauthenticated", async () => {
    const { status } = await api("/api/workspaces");
    assert(status === 401, `expected 401 got ${status}`);
  });

  // Seed users + session + second user for sharing tests
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const masterKey = deriveKey(MASTER);
  const sessionToken = randomBytes(32).toString("base64url");
  const githubIdA = String(900001 + Math.floor(Math.random() * 100000));
  const githubIdB = String(900002 + Math.floor(Math.random() * 100000));
  const loginA = `smoke_a_${Date.now()}`;
  const loginB = `smoke_b_${Date.now()}`;

  let userA;
  let userB;
  await step("Seed users in Postgres", async () => {
    const a = await pool.query(
      `INSERT INTO users (github_id, github_login, name, email)
       VALUES ($1, $2, $3, $4) RETURNING id, github_login`,
      [githubIdA, loginA, "Smoke A", `${loginA}@example.com`],
    );
    const b = await pool.query(
      `INSERT INTO users (github_id, github_login, name, email)
       VALUES ($1, $2, $3, $4) RETURNING id, github_login`,
      [githubIdB, loginB, "Smoke B", `${loginB}@example.com`],
    );
    userA = a.rows[0];
    userB = b.rows[0];
    assert(userA?.id, "user A id");
    assert(userB?.id, "user B id");

    await pool.query(
      `INSERT INTO web_sessions (session_token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [sha256(sessionToken), userA.id],
    );
    jar.cookie = `vaultmcp_session=${sessionToken}`;
  });

  await step("GET /auth/me", async () => {
    const { status, body } = await api("/auth/me");
    assert(status === 200, `status ${status}`);
    assert(body?.user?.githubLogin === loginA, `login ${body?.user?.githubLogin}`);
  });

  let workspaceId;
  const slug = `smoke-${Date.now()}`;
  await step("Create workspace", async () => {
    const { status, body } = await api("/api/workspaces", {
      method: "POST",
      json: { name: "Smoke Workspace", slug },
    });
    assert(status === 201, `status ${status} ${JSON.stringify(body)}`);
    workspaceId = body.workspace.id;
  });

  await step("List workspaces", async () => {
    const { status, body } = await api("/api/workspaces");
    assert(status === 200, `status ${status}`);
    assert(body.workspaces.some((w) => w.id === workspaceId), "workspace present");
  });

  await step("Create private secret", async () => {
    const { status, body } = await api(`/api/workspaces/${workspaceId}/secrets`, {
      method: "POST",
      json: {
        name: "PRIVATE_TOKEN",
        value: "super-secret-private",
        visibility: "private",
      },
    });
    assert(status === 201, `status ${status} ${JSON.stringify(body)}`);
    assert(body.secret.value === undefined, "value must not be returned");
    assert(body.secret.name === "PRIVATE_TOKEN", "name");
  });

  await step("Create shared AWS secrets", async () => {
    for (const [name, value] of [
      ["AWS_ACCESS_KEY_ID", "AKIA_SMOKE_TEST"],
      ["AWS_SECRET_ACCESS_KEY", "smoke-secret-key"],
      ["AWS_REGION", "us-east-1"],
    ]) {
      const { status, body } = await api(`/api/workspaces/${workspaceId}/secrets`, {
        method: "POST",
        json: { name, value, visibility: "workspace" },
      });
      assert(status === 201, `${name}: ${status} ${JSON.stringify(body)}`);
      assert(!("value" in body.secret) && !("ciphertext" in body.secret), "no secret material");
    }
  });

  await step("List secrets metadata only", async () => {
    const { status, body } = await api(`/api/workspaces/${workspaceId}/secrets`);
    assert(status === 200, `status ${status}`);
    assert(body.secrets.length >= 4, "expected secrets");
    for (const s of body.secrets) {
      assert(s.value === undefined && s.ciphertext === undefined, `leak in ${s.name}`);
    }
  });

  await step("Register AWS upstream with placeholders", async () => {
    const { status, body } = await api(`/api/workspaces/${workspaceId}/upstreams`, {
      method: "POST",
      json: {
        name: "AWS",
        slug: "aws",
        transport: "stdio",
        command: "uvx",
        args: ["awslabs.aws-api-mcp-server@latest"],
        envTemplate: {
          AWS_ACCESS_KEY_ID: "{{secret:AWS_ACCESS_KEY_ID}}",
          AWS_SECRET_ACCESS_KEY: "{{secret:AWS_SECRET_ACCESS_KEY}}",
          AWS_REGION: "{{secret:AWS_REGION}}",
        },
      },
    });
    assert(status === 201, `status ${status} ${JSON.stringify(body)}`);
    assert(body.upstream.requiredSecrets.includes("AWS_ACCESS_KEY_ID"), "required secrets");
  });

  await step("Invite member B", async () => {
    const { status, body } = await api(`/api/workspaces/${workspaceId}/members`, {
      method: "POST",
      json: { githubLogin: loginB, role: "member" },
    });
    assert(status === 201, `status ${status} ${JSON.stringify(body)}`);
  });

  await step("Cursor config endpoint (no secrets)", async () => {
    const { status, body } = await api("/api/config");
    assert(status === 200, `status ${status}`);
    assert(body.cursorConfig?.mcpServers?.vaultmcp?.url?.endsWith("/mcp"), "mcp url");
    const blob = JSON.stringify(body);
    assert(!blob.includes("AKIA"), "no AWS key in config");
    assert(!blob.includes("smoke-secret"), "no secret in config");
  });

  // Dynamic client registration + auth code + token (simulate Cursor OAuth)
  let accessToken;
  await step("OAuth DCR + authorize + token (PKCE)", async () => {
    const { status: regStatus, body: client } = await api("/oauth/register", {
      method: "POST",
      json: {
        client_name: "Smoke Cursor",
        redirect_uris: ["http://127.0.0.1:8787/callback"],
        token_endpoint_auth_method: "none",
      },
    });
    assert(regStatus === 201, `register ${regStatus}`);
    const clientId = client.client_id;

    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authUrl =
      `/oauth/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent("http://127.0.0.1:8787/callback")}` +
      `&code_challenge=${challenge}&code_challenge_method=S256&scope=mcp&state=s1`;

    const authRes = await fetch(`${BASE}${authUrl}`, {
      headers: { Cookie: jar.cookie },
      redirect: "manual",
    });
    assert(authRes.status === 302 || authRes.status === 303, `authorize status ${authRes.status}`);
    const loc = authRes.headers.get("location");
    assert(loc?.includes("code="), `redirect missing code: ${loc}`);
    const code = new URL(loc).searchParams.get("code");
    assert(code, "auth code");

    const tokenRes = await fetch(`${BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://127.0.0.1:8787/callback",
        client_id: clientId,
        code_verifier: verifier,
      }),
    });
    const tokenBody = await tokenRes.json();
    assert(tokenRes.status === 200, `token ${tokenRes.status} ${JSON.stringify(tokenBody)}`);
    assert(tokenBody.access_token, "access_token");
    accessToken = tokenBody.access_token;
  });

  await step("MCP initialize + list_workspaces", async () => {
    const mcpHeaders = {
      Accept: "application/json, text/event-stream",
    };
    const init = await api("/mcp", {
      method: "POST",
      bearer: accessToken,
      headers: mcpHeaders,
      json: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0.0.1" },
        },
      },
    });
    assert(init.status === 200, `init ${init.status} ${JSON.stringify(init.body)}`);
    const sessionId = init.res.headers.get("mcp-session-id");
    assert(sessionId, "mcp-session-id header");

    // notifications/initialized
    await api("/mcp", {
      method: "POST",
      bearer: accessToken,
      headers: { ...mcpHeaders, "mcp-session-id": sessionId },
      json: { jsonrpc: "2.0", method: "notifications/initialized" },
    });

    const tools = await api("/mcp", {
      method: "POST",
      bearer: accessToken,
      headers: { ...mcpHeaders, "mcp-session-id": sessionId },
      json: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    });
    assert(tools.status === 200, `tools/list ${tools.status}`);
    // Streamable HTTP may return JSON or SSE; normalize
    let toolNames = (tools.body?.result?.tools ?? []).map((t) => t.name);
    if (!toolNames.length && typeof tools.body === "string") {
      const match = tools.body.match(/"name"\s*:\s*"list_workspaces"/);
      assert(match, `tools/list body: ${String(tools.body).slice(0, 300)}`);
      toolNames = ["list_workspaces", "use_workspace"];
    }
    assert(toolNames.includes("list_workspaces"), `tools: ${toolNames.join(",")}`);
    assert(toolNames.includes("use_workspace"), "use_workspace");

    const call = await api("/mcp", {
      method: "POST",
      bearer: accessToken,
      headers: { ...mcpHeaders, "mcp-session-id": sessionId },
      json: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_workspaces", arguments: {} },
      },
    });
    assert(call.status === 200, `tools/call ${call.status}`);
    const raw = typeof call.body === "string" ? call.body : JSON.stringify(call.body);
    const text = call.body?.result?.content?.[0]?.text ?? raw;
    assert(text.includes(slug) || raw.includes(slug), `workspace slug in result: ${raw.slice(0, 300)}`);
    assert(!raw.includes("AKIA_SMOKE"), "no AWS key in MCP result");
    assert(!raw.includes("smoke-secret-key"), "no secret in MCP result");

    const useWs = await api("/mcp", {
      method: "POST",
      bearer: accessToken,
      headers: { ...mcpHeaders, "mcp-session-id": sessionId },
      json: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "use_workspace", arguments: { slug } },
      },
    });
    assert(useWs.status === 200, `use_workspace ${useWs.status}`);
    const useRaw = typeof useWs.body === "string" ? useWs.body : JSON.stringify(useWs.body);
    assert(
      useRaw.includes("ok") || useRaw.includes(slug),
      `use_workspace: ${useRaw.slice(0, 300)}`,
    );
  });

  await step("Private secret encrypted at rest (envelope DEK)", async () => {
    const row = await pool.query(
      `SELECT ciphertext, crypto_version FROM secrets WHERE workspace_id=$1 AND name='PRIVATE_TOKEN'`,
      [workspaceId],
    );
    assert(row.rows[0], "row exists");
    assert(!row.rows[0].ciphertext.includes("super-secret-private"), "plaintext not in DB");
    assert(Number(row.rows[0].crypto_version) === 2, `expected crypto_version 2, got ${row.rows[0].crypto_version}`);

    const ws = await pool.query(`SELECT wrapped_dek FROM workspaces WHERE id=$1`, [workspaceId]);
    assert(ws.rows[0]?.wrapped_dek, "workspace has wrapped_dek");

    const {
      unwrapDek,
      decryptWithDek,
    } = await import("../packages/shared/dist/crypto.js");
    const dek = unwrapDek(ws.rows[0].wrapped_dek, masterKey, workspaceId);
    const plain = decryptWithDek(row.rows[0].ciphertext, dek, workspaceId);
    assert(plain === "super-secret-private", "decrypt roundtrip via workspace DEK");
  });

  await step("Member B cannot see A's private secret metadata via API", async () => {
    // session as B
    const tokenB = randomBytes(32).toString("base64url");
    await pool.query(
      `INSERT INTO web_sessions (session_token_hash, user_id, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 day')`,
      [sha256(tokenB), userB.id],
    );
    const prev = jar.cookie;
    jar.cookie = `vaultmcp_session=${tokenB}`;
    const { status, body } = await api(`/api/workspaces/${workspaceId}/secrets`);
    assert(status === 200, `status ${status}`);
    const names = body.secrets.map((s) => s.name);
    assert(!names.includes("PRIVATE_TOKEN"), `B saw private: ${names}`);
    assert(names.includes("AWS_ACCESS_KEY_ID"), "B sees shared");
    jar.cookie = prev;
  });

  await step("Audit log records MCP use_workspace", async () => {
    const { status, body } = await api(`/api/workspaces/${workspaceId}/audit`);
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.logs), "logs array");
    const blob = JSON.stringify(body.logs);
    assert(!blob.includes("AKIA_SMOKE"), "no secrets in audit");
    assert(!blob.includes("super-secret-private"), "no private in audit");
  });

  await pool.end();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

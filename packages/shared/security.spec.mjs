/**
 * Unit checks for OAuth redirect, post-login returnTo, stdio env, SSRF IP
 * classification, header CRLF, and upstream PATCH schema.
 * Run: pnpm --filter @vaultmcp/shared test:security
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const {
  isAllowedOAuthRedirect,
  filterOAuthRedirectUris,
  safePostLoginDest,
  stdioChildEnv,
  HOST_ENV_DENYLIST,
  containsCtlChars,
  isLoopbackHost,
  isBlockedUpstreamHost,
  isMetadataOrLinkLocalIp,
  isPrivateOrLoopbackIp,
  UpdateUpstreamSchema,
  isAllowedCsrfOrigin,
} = await import(path.join(here, "dist/security.js"));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertThrows(fn, msg) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert(threw, msg);
}

// --- OAuth redirects: loopback / native only (blocks auth-code theft) ---
assert(isAllowedOAuthRedirect("http://127.0.0.1:1234/callback"), "loopback ipv4");
assert(isAllowedOAuthRedirect("http://localhost:8700/callback"), "localhost");
assert(isAllowedOAuthRedirect("http://[::1]:8080/oauth/callback"), "loopback ipv6");
assert(isAllowedOAuthRedirect("cursor://anysphere.cursor-mcp/oauth/callback"), "cursor native");
assert(isAllowedOAuthRedirect("vscode://vscode.github-authentication/did-authenticate"), "vscode native");
assert(!isAllowedOAuthRedirect("https://evil.example/cb"), "https attacker");
assert(!isAllowedOAuthRedirect("https://vaultmcp.dev/oauth/callback"), "https even own host");
assert(!isAllowedOAuthRedirect("javascript:alert(1)"), "javascript");
assert(!isAllowedOAuthRedirect("not a url"), "garbage");

const filtered = filterOAuthRedirectUris([
  "http://127.0.0.1:9/callback",
  "https://evil.example/cb",
  "cursor://ok",
]);
assert(filtered.length === 2, "DCR drops attacker https");
assertThrows(() => filterOAuthRedirectUris(["https://evil.example/cb"]), "DCR with only attacker URIs fails");

// --- Post-login returnTo ---
const web = "https://vaultmcp.dev";
const api = "https://vaultmcp.dev";
assert(
  safePostLoginDest("/workspaces/abc", web, api) === "https://vaultmcp.dev/workspaces/abc",
  "relative path",
);
assert(
  safePostLoginDest("https://vaultmcp.dev/oauth/authorize?x=1", web, api).startsWith(
    "https://vaultmcp.dev/oauth/authorize",
  ),
  "same-origin absolute",
);
assert(safePostLoginDest("https://evil.example/phish", web, api) === "https://vaultmcp.dev/", "open redirect");
assert(safePostLoginDest("//evil.example", web, api) === "https://vaultmcp.dev/", "protocol-relative");
assert(safePostLoginDest("https://vaultmcp.dev.evil.example/", web, api) === "https://vaultmcp.dev/", "suffix host");
assert(safePostLoginDest("http://evil.example", web, api) === "https://vaultmcp.dev/", "http attacker");

// --- stdio child env must not inherit host secrets ---
const child = stdioChildEnv(
  {
    PATH: "/usr/bin",
    HOME: "/home/node",
    VAULT_MASTER_KEY: "kek-must-not-leak",
    DATABASE_URL: "postgres://secret",
    GITHUB_CLIENT_SECRET: "gh-secret",
    REDIS_URL: "redis://secret",
    LANG: "en_US.UTF-8",
  },
  { AWS_SECRET_ACCESS_KEY: "injected-from-vault" },
);
assert(child.PATH === "/usr/bin", "PATH forwarded");
assert(child.AWS_SECRET_ACCESS_KEY === "injected-from-vault", "injected secrets present");
assert(child.VAULT_MASTER_KEY === undefined, "KEK not inherited");
assert(child.DATABASE_URL === undefined, "DATABASE_URL not inherited");
assert(child.GITHUB_CLIENT_SECRET === undefined, "GitHub secret not inherited");
assert(HOST_ENV_DENYLIST.includes("VAULT_MASTER_KEY"), "denylist includes KEK");

// Injected names that collide with host secrets are dropped
const collide = stdioChildEnv({ PATH: "/bin" }, { VAULT_MASTER_KEY: "attacker-named-secret" });
assert(collide.VAULT_MASTER_KEY === undefined, "injected key cannot spoof KEK name");

// --- Header / env CRLF ---
assert(!containsCtlChars("ok-value"), "no ctl");
assert(containsCtlChars("Bearer tok\r\nX-Injected: 1"), "crlf");
assert(containsCtlChars("a\nb"), "lf");

// --- SSRF helpers ---
assert(isLoopbackHost("127.0.0.1"), "loopback ip host");
assert(isLoopbackHost("localhost"), "localhost host");
assert(isLoopbackHost("[::1]"), "ipv6 loopback host");
assert(isBlockedUpstreamHost("169.254.169.254"), "aws metadata host");
assert(isBlockedUpstreamHost("metadata.google.internal"), "gcp metadata host");
assert(!isBlockedUpstreamHost("mcp.example.com"), "public host ok");
assert(isMetadataOrLinkLocalIp("169.254.169.254"), "link-local ip");
assert(isPrivateOrLoopbackIp("10.0.0.1"), "rfc1918");
assert(isPrivateOrLoopbackIp("192.168.1.1"), "rfc1918 192.168");
assert(isPrivateOrLoopbackIp("127.0.0.1"), "loopback ip");
assert(!isPrivateOrLoopbackIp("8.8.8.8"), "public ip");
assert(isPrivateOrLoopbackIp("::1"), "ipv6 loopback");
assert(isPrivateOrLoopbackIp("::ffff:10.1.2.3"), "ipv4-mapped private");

// --- PATCH schema rejects workspaceId ---
const parsed = UpdateUpstreamSchema.safeParse({ name: "ok", workspaceId: "other-ws" });
assert(!parsed.success, "workspaceId mass-assignment rejected");
assert(UpdateUpstreamSchema.safeParse({ name: "renamed", enabled: false }).success, "allowed fields");
assert(!UpdateUpstreamSchema.safeParse({ slug: "hijack" }).success, "slug not patchable");

// --- CSRF origin ---
assert(isAllowedCsrfOrigin(undefined, web), "non-browser ok");
assert(isAllowedCsrfOrigin("https://vaultmcp.dev", web), "same origin");
assert(!isAllowedCsrfOrigin("https://evil.example", web), "cross origin");

console.log("security.spec: ok");

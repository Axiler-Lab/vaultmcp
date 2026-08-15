import { z } from "zod";

/** Native MCP client schemes. HTTPS callbacks are never accepted (auth-code theft). */
const NATIVE_OAUTH_SCHEMES = new Set(["cursor:", "vscode:", "vscode-insiders:"]);

export const HOST_ENV_DENYLIST = [
  "VAULT_MASTER_KEY",
  "DATABASE_URL",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "REDIS_URL",
  "SESSION_COOKIE_NAME",
] as const;

const STDIO_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "npm_config_cache",
  "npm_config_prefix",
  "UV_CACHE_DIR",
  "VIRTUAL_ENV",
] as const;

const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.google.com",
  "metadata.goog",
]);

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0:0:0:0:0:0:0:1";
}

export function isAllowedOAuthRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    const protocol = u.protocol.toLowerCase();
    if (NATIVE_OAUTH_SCHEMES.has(protocol)) return true;
    if (protocol !== "http:" && protocol !== "https:") return false;
    return isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

export function filterOAuthRedirectUris(uris: string[]): string[] {
  const allowed = [...new Set(uris.filter((u) => typeof u === "string" && isAllowedOAuthRedirect(u)))];
  if (allowed.length === 0) {
    throw new Error("redirect_uris must be loopback http(s) or a native client scheme");
  }
  return allowed;
}

export function safePostLoginDest(returnTo: string, webOrigin: string, publicUrl: string): string {
  const fallback = `${webOrigin.replace(/\/$/, "")}/`;
  const allowedOrigins = new Set<string>();
  for (const raw of [webOrigin, publicUrl]) {
    try {
      allowedOrigins.add(new URL(raw).origin);
    } catch {
      /* ignore */
    }
  }

  if (returnTo.startsWith("//") || returnTo.includes("\\") || returnTo.includes("\r") || returnTo.includes("\n")) {
    return fallback;
  }

  if (!returnTo.startsWith("http://") && !returnTo.startsWith("https://")) {
    const path = returnTo.startsWith("/") ? returnTo : `/${returnTo}`;
    return `${webOrigin.replace(/\/$/, "")}${path}`;
  }

  try {
    const u = new URL(returnTo);
    if (allowedOrigins.has(u.origin)) return returnTo;
  } catch {
    /* fall through */
  }
  return fallback;
}

export function containsCtlChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c === 127) return true;
  }
  return false;
}

export function stdioChildEnv(
  hostEnv: Record<string, string | undefined>,
  injected: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of STDIO_ENV_ALLOWLIST) {
    const v = hostEnv[key];
    if (typeof v === "string" && v.length > 0 && !containsCtlChars(v)) {
      out[key] = v;
    }
  }
  const deny = new Set<string>(HOST_ENV_DENYLIST);
  for (const [key, value] of Object.entries(injected)) {
    if (deny.has(key)) continue;
    if (containsCtlChars(key) || containsCtlChars(value)) {
      throw new Error(`Refusing to inject control characters into env ${key}`);
    }
    out[key] = value;
  }
  return out;
}

export function isBlockedUpstreamHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(h)) return true;
  if (h.endsWith(".metadata.google.internal")) return true;
  return false;
}

function ipv4FromMapped(ip: string): string | null {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  return m?.[1] ?? null;
}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

export function isMetadataOrLinkLocalIp(ip: string): boolean {
  const v4 = ipv4FromMapped(ip) ?? ip;
  const parts = parseIpv4(v4);
  if (parts) {
    return parts[0] === 169 && parts[1] === 254;
  }
  const h = ip.toLowerCase();
  return h.startsWith("fe80:");
}

export function isPrivateOrLoopbackIp(ip: string): boolean {
  const v4 = ipv4FromMapped(ip) ?? ip;
  const parts = parseIpv4(v4);
  if (parts) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const h = ip.toLowerCase();
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  return false;
}

export function isAllowedCsrfOrigin(origin: string | undefined, webOrigin: string): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(webOrigin).origin;
  } catch {
    return false;
  }
}

/** PATCH body for upstreams — never workspaceId / slug / transport / createdBy. */
export const UpdateUpstreamSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    command: z.string().max(512).nullable().optional(),
    args: z.array(z.string().max(512)).max(50).optional(),
    url: z.string().url().nullable().optional(),
    envTemplate: z.record(z.string().max(8000)).optional(),
    headersTemplate: z.record(z.string().max(8000)).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type UpdateUpstreamInput = z.infer<typeof UpdateUpstreamSchema>;

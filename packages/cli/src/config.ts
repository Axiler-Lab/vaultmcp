import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CliConfig = {
  url: string;
  token: string;
};

function configPath(): string {
  const override = process.env.VAULTMCP_CONFIG;
  if (override) return override;
  const base =
    process.env.XDG_CONFIG_HOME?.trim() ||
    join(homedir(), ".config");
  return join(base, "vaultmcp", "config.json");
}

export function loadConfig(): CliConfig | null {
  const url = process.env.VAULTMCP_URL?.trim();
  const token = process.env.VAULTMCP_TOKEN?.trim();
  if (url && token) {
    return { url: normalizeBaseUrl(url), token };
  }

  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<CliConfig>;
    if (!raw.url || !raw.token) return null;
    return { url: normalizeBaseUrl(raw.url), token: raw.token };
  } catch {
    return null;
  }
}

export function saveConfig(cfg: CliConfig): string {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = JSON.stringify(
    { url: normalizeBaseUrl(cfg.url), token: cfg.token },
    null,
    2,
  );
  writeFileSync(path, `${body}\n`, { mode: 0o600, encoding: "utf8" });
  try {
    chmodSync(path, 0o600);
    chmodSync(dirname(path), 0o700);
  } catch {
    // best-effort on platforms that ignore mode
  }
  return path;
}

export function normalizeBaseUrl(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (u.endsWith("/mcp")) {
    u = u.slice(0, -4);
  }
  return u;
}

export function warnInsecureUrl(url: string): void {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const loopback =
      host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
    if (parsed.protocol === "http:" && !loopback) {
      console.error(
        "warning: using http:// to a non-loopback host — secrets travel in cleartext. Prefer https://.",
      );
    }
  } catch {
    // ignore
  }
}

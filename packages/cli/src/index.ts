#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fetchRuntimeEnv } from "./client.js";
import { loadConfig, normalizeBaseUrl, saveConfig, warnInsecureUrl } from "./config.js";

function usage(): never {
  console.error(`vaultmcp — fetch shared workspace env from VaultMCP

Usage:
  vaultmcp login --token <vmcp_…> --url <https://host>
  vaultmcp run -w <slug> [--names A,B] -- <command> [args…]
  vaultmcp env -w <slug> [--names A,B] [--format json|dotenv]

Environment overrides:
  VAULTMCP_URL    API origin (no /mcp suffix)
  VAULTMCP_TOKEN  Personal access token with env scope
  VAULTMCP_CONFIG Config file path (default ~/.config/vaultmcp/config.json)

Security:
  Prefer \`run\` (secrets only in the child process env).
  \`env\` prints secrets to stdout — never commit the output.
  Mint env-only PATs for laptops; revoke on offboarding.
  Rotation applies on the next run (restart long-lived processes).
`);
  process.exit(2);
}

function requireConfig() {
  const cfg = loadConfig();
  if (!cfg) {
    console.error("Not logged in. Run: vaultmcp login --token vmcp_… --url https://host");
    process.exit(1);
  }
  return cfg;
}

function parseNames(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const names = raw
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length ? names : undefined;
}

function toDotenv(secrets: Record<string, string>): string {
  return Object.entries(secrets)
    .map(([k, v]) => {
      const escaped = v
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n");
      return `${k}="${escaped}"`;
    })
    .join("\n");
}

async function cmdLogin(argv: string[]) {
  let token = "";
  let url = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--token") token = argv[++i] ?? "";
    else if (a === "--url") url = argv[++i] ?? "";
    else if (a === "-h" || a === "--help") usage();
  }
  if (!token || !url) {
    console.error("login requires --token and --url");
    process.exit(1);
  }
  if (!token.startsWith("vmcp_")) {
    console.error("token must be a personal access token starting with vmcp_");
    process.exit(1);
  }
  const normalized = normalizeBaseUrl(url);
  warnInsecureUrl(normalized);
  const path = saveConfig({ url: normalized, token });
  console.error(`Saved credentials to ${path} (mode 0600).`);
  console.error("Next: vaultmcp run -w <workspace-slug> -- <your command>");
}

async function cmdRun(argv: string[]) {
  let workspace = "";
  let namesRaw: string | undefined;
  const cmdArgs: string[] = [];
  let afterDash = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (afterDash) {
      cmdArgs.push(a);
      continue;
    }
    if (a === "--") {
      afterDash = true;
      continue;
    }
    if (a === "-w" || a === "--workspace") workspace = argv[++i] ?? "";
    else if (a === "--names") namesRaw = argv[++i];
    else if (a === "-h" || a === "--help") usage();
    else {
      console.error(`Unknown option: ${a}`);
      usage();
    }
  }
  if (!workspace || cmdArgs.length === 0) {
    console.error("run requires -w <slug> and -- <command>");
    usage();
  }

  const cfg = requireConfig();
  const data = await fetchRuntimeEnv(cfg, {
    workspace,
    names: parseNames(namesRaw),
  });

  const childEnv = { ...process.env, ...data.secrets };
  const [command, ...args] = cmdArgs;
  const child = spawn(command!, args, {
    env: childEnv,
    stdio: "inherit",
    shell: false,
  });

  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  const code: number = await new Promise((resolve) => {
    child.on("error", (err) => {
      console.error(err.message);
      resolve(127);
    });
    child.on("close", (c, signal) => {
      if (signal) resolve(1);
      else resolve(c ?? 1);
    });
  });
  process.exit(code);
}

async function cmdEnv(argv: string[]) {
  let workspace = "";
  let namesRaw: string | undefined;
  let format: "json" | "dotenv" = "dotenv";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "-w" || a === "--workspace") workspace = argv[++i] ?? "";
    else if (a === "--names") namesRaw = argv[++i];
    else if (a === "--format") {
      const f = argv[++i];
      if (f !== "json" && f !== "dotenv") {
        console.error("--format must be json or dotenv");
        process.exit(1);
      }
      format = f;
    } else if (a === "-h" || a === "--help") usage();
    else {
      console.error(`Unknown option: ${a}`);
      usage();
    }
  }
  if (!workspace) {
    console.error("env requires -w <slug>");
    usage();
  }

  console.error(
    "warning: `vaultmcp env` prints secret values to stdout. Prefer `vaultmcp run`. Do not commit the output.",
  );

  const cfg = requireConfig();
  const data = await fetchRuntimeEnv(cfg, {
    workspace,
    names: parseNames(namesRaw),
  });

  if (format === "json") {
    process.stdout.write(`${JSON.stringify(data.secrets, null, 2)}\n`);
  } else {
    process.stdout.write(`${toDotenv(data.secrets)}\n`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();

  try {
    if (cmd === "login") await cmdLogin(argv.slice(1));
    else if (cmd === "run") await cmdRun(argv.slice(1));
    else if (cmd === "env") await cmdEnv(argv.slice(1));
    else {
      console.error(`Unknown command: ${cmd}`);
      usage();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();

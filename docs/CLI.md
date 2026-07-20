# VaultMCP CLI (`@vaultmcp-axiler/cli`)

Share workspace secrets with local apps — no copying `.env` files between teammates.

The CLI is part of the open-source VaultMCP repo ([Axiler Labs](https://axiler.com)). Product site: [vaultmcp.dev](https://vaultmcp.dev). Source: [`packages/cli`](../packages/cli). Published on npm as [`@vaultmcp-axiler/cli`](https://www.npmjs.com/package/@vaultmcp-axiler/cli).

## MCP vs CLI

| | MCP (IDE agents) | CLI (local apps) |
|--|--|--|
| **For** | Cursor / Claude / other MCP clients | `npm run dev`, scripts, tooling |
| **Secrets** | Stay server-side; injected into upstreams | Exported as plaintext into the child process |
| **Token** | MCP read / read-write PAT | **Runtime env (CLI)** preset — `env` scope only |
| **Endpoint** | `/mcp` | API origin + `/api/runtime/v1/env` |

These tokens are **not interchangeable**. Use the matching Connect preset in the dashboard.

## Install

Requires **Node.js 22+**.

```bash
npx @vaultmcp-axiler/cli@latest --help

# or install globally
npm i -g @vaultmcp-axiler/cli
vaultmcp --help
```

## Setup

1. In VaultMCP, store team secrets with **workspace** (shared) visibility.
2. Create a personal access token with the **Runtime env (CLI)** preset (`env` scope only). Short expiry is recommended.
3. Point the CLI at your **API origin** (not the `/mcp` URL):

```bash
npx @vaultmcp-axiler/cli@latest login --token vmcp_… --url https://YOUR_HOST
npx @vaultmcp-axiler/cli@latest run -w your-slug -- npm run dev
```

Credentials are saved to `~/.config/vaultmcp/config.json` (mode `0600`).

### One-off / CI (no config file)

```bash
export VAULTMCP_URL=https://YOUR_HOST
export VAULTMCP_TOKEN=vmcp_…
npx @vaultmcp-axiler/cli@latest run -w your-slug --names DATABASE_URL,GITHUB_TOKEN -- npm run dev
```

`VAULTMCP_URL` and `VAULTMCP_TOKEN` override the config file. Optional: `VAULTMCP_CONFIG` to point at a different config path.

## Commands

| Command | Purpose |
|---------|---------|
| `vaultmcp login --token … --url …` | Save credentials to the config file |
| `vaultmcp run -w <slug> [--names A,B] -- <cmd>` | Fetch secrets, merge into child env, run command (**preferred**) |
| `vaultmcp env -w <slug> [--names A,B] [--format json\|dotenv]` | Print secrets to stdout — do not commit the output |

Prefer **`run`** so values exist only in the child process. Use **`env`** only when you need a dump (and treat the output as sensitive).

Rotate secrets in the VaultMCP dashboard; teammates pick up new values on the next `run` (restart long-lived processes after rotation).

## Examples

```bash
# Full workspace env into a local server
vaultmcp run -w acme -- npm run dev

# Only selected names
vaultmcp run -w acme --names DATABASE_URL,REDIS_URL -- pnpm start

# Dump as dotenv (sensitive — do not commit)
vaultmcp env -w acme --format dotenv > /tmp/env.local

# Dump as JSON
vaultmcp env -w acme --format json
```

## Security

- Runtime export **widens** the trust boundary vs MCP: plaintext reaches the laptop.
- Use short-lived **env-only** tokens; revoke them on offboarding.
- Prefer `run` over `env` and over writing shared `.env` files.
- Use HTTPS except for localhost.
- Server API: `GET /api/runtime/v1/env?workspace=<slug>` with `Authorization: Bearer vmcp_…` (`env` scope). Responses use `Cache-Control: no-store`.

## Developing the CLI

From the monorepo root:

```bash
pnpm install
pnpm --filter @vaultmcp-axiler/cli build
pnpm vaultmcp --help
```

Contributions welcome — see the [main README](../README.md#contributing). Product: [vaultmcp.dev](https://vaultmcp.dev) · Axiler Labs: [axiler.com](https://axiler.com).

## License

AGPL-3.0-only · Copyright © 2026 Axiler Labs

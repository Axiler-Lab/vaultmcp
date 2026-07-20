# VaultMCP production deploy (Axiler Labs)

Licensed under [AGPL-3.0-only](../LICENSE). Copyright © 2026 Axiler Labs.

## Architecture

Docker Compose runs Postgres, Redis, API, web (static nginx), and a public **reverse proxy on port 80**.

```
Internet → :80 (proxy) → web UI (/)
                      → api (:3001) for /api /auth /oauth /mcp /health /.well-known
```

Only **port 80** is published publicly. API (`3001`) and web container (`80`) stay on the Compose network. Postgres/Redis are bound to `127.0.0.1` on the host.

## Deploy notes

UI deploys via **Vercel** (Git integration on `Axiler-Lab/vaultmcp`). API/MCP on the VPS is updated manually (rsync + `docker compose` on the host). There is no GitHub Actions CD workflow in this repo.


## IP-first (before domain)

1. On the VPS `.env`, set:
   - `PUBLIC_URL=http://YOUR_SERVER_IP`
   - `WEB_ORIGIN=http://YOUR_SERVER_IP`
   - `VITE_API_URL=` (empty) or omit
   - `COOKIE_SECURE=false`
2. GitHub OAuth App:
   - **Homepage URL:** `http://YOUR_SERVER_IP`
   - **Authorization callback URL:** `http://YOUR_SERVER_IP/auth/github/callback`
3. Open firewall for TCP **80** (and SSH). Do not rely on `:5173` / `:3001` for public access.
4. Update the VPS stack after changing server env/secrets.
5. Verify:
   - `curl -sS http://YOUR_SERVER_IP/health` → `{"ok":true,…}`
   - Browser: `http://YOUR_SERVER_IP/`
   - MCP discovery: `curl -sS http://YOUR_SERVER_IP/.well-known/oauth-protected-resource`

### Cursor MCP config (deployed)

```json
{
  "mcpServers": {
    "vaultmcp": {
      "url": "http://YOUR_SERVER_IP/mcp"
    }
  }
}
```

Cursor completes OAuth (Streamable HTTP). No provider secrets in `mcp.json`.

**Naming:** config key and Settings label are `vaultmcp`. Cursor agent logs often show `user-vaultmcp` (same server). Upstream tools look like `github__…` and still run through this gateway.

## Split hosting (dashboard on Vercel, API on VPS)

Production reference:

| Surface | Host |
|---------|------|
| Public front door (UI + MCP + OAuth) | [vaultmcp.dev](https://vaultmcp.dev) (Vercel; API paths proxied) |
| Origin API (Compose on the VPS) | VPS host IP (Vercel rewrite target only — not for clients) |

Set on the VPS `.env`:

- `PUBLIC_URL=https://vaultmcp.dev` (what OAuth discovery / MCP configs advertise)
- `WEB_ORIGIN=https://vaultmcp.dev` (same origin as the dashboard)
- `COOKIE_SECURE=true`
- `VITE_API_URL=` empty (same-origin relative calls; see `apps/web/.env.production`)

GitHub OAuth App:

- Homepage URL: `https://vaultmcp.dev`
- Callback URL: `https://vaultmcp.dev/auth/github/callback`

Vercel `vercel.json` rewrites `/mcp`, `/api`, `/auth`, `/oauth`, `/.well-known`, `/health` to the **VPS origin** (never back to `vaultmcp.dev`, or you get a rewrite loop). SPA catch-all is last.

Vercel: connect the GitHub repo (auto-deploy on push). Prefer **local `vercel build` + `--prebuilt`** if remote builds hang.

Clients and docs should only use **https://vaultmcp.dev** (including MCP: `https://vaultmcp.dev/mcp`).

## Adding an API domain later

1. Point DNS **A/AAAA** at the VPS IP for the API host.
2. Update `PUBLIC_URL` (and OAuth callback) to that HTTPS origin.
3. Keep `WEB_ORIGIN` as the Vercel dashboard URL unless you move the UI.
4. Set `COOKIE_SECURE=true`.
5. Add TLS (Caddy/nginx/certbot or cloud LB).
6. Redeploy the VPS stack (on the VPS).
7. Point Cursor at `https://your-api-host/mcp`.

## Cloudflare + Cursor MCP (`net::ERR_FAILED`)

Cursor’s Streamable HTTP client uses Chromium’s network stack. It often sends `Origin: null` (Electron). MCP OAuth discovery and `/mcp` **must** echo that Origin (like Notion’s MCP). Cookie CORS for the web UI (`WEB_ORIGIN` + credentials) must **not** apply to `/mcp`, `/.well-known/*`, or `/oauth/*`.

Nginx must route **`/mcp` and `/mcp/`** to the API (prefix `location /mcp`). Exact-match `= /mcp` previously served the SPA HTML for `/mcp/`, which breaks clients that add a trailing slash.

### Cloudflare checklist (edge)

If Cursor still shows `net::ERR_FAILED` after deploying API/nginx CORS fixes:

1. **Custom rules / WAF skip** for URI paths:
   - `/mcp*`
   - `/.well-known/*`
   - `/oauth*`
   - `/register*` (if used)
2. **Bot Fight Mode / Super Bot Fight**: disable or skip the paths above (challenges break non-browser Electron).
3. **Security Level**: temporarily “Essentially Off” to test; if that fixes it, add path exceptions rather than leaving it off.
4. Turn **off** for the zone or these paths: Rocket Loader, Email Obfuscation, Mirage, Auto Minify (HTML/JS).
5. **QUIC / HTTP/3**: if Electron fails while `curl` works, try Cursor **Settings → Network → HTTP Compatibility Mode → HTTP/1.1**, or disable HTTP/3 on the Cloudflare domain while testing (`Network` → HTTP/3).
6. Ensure DNS is **proxied** (orange cloud) only if origin TLS/routing is correct; grey-cloud to the VPS is fine for debugging.
7. Do **not** cache `/mcp` or `/.well-known/*` (`Cache Rules` → Bypass).

### Verify after deploy

```bash
# Chromium-like Origin must be echoed (not WEB_ORIGIN)
curl -sSI -H 'Origin: null' https://YOUR_DOMAIN/mcp | grep -i access-control-allow-origin
# expect: access-control-allow-origin: null

curl -sS https://YOUR_DOMAIN/.well-known/oauth-protected-resource/mcp
curl -sS -D - -o /dev/null -X POST -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' -H 'Origin: null' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' \
  https://YOUR_DOMAIN/mcp
# expect: 401 + WWW-Authenticate resource_metadata=.../oauth-protected-resource/mcp
# + access-control-allow-origin: null
```

Cursor config: `"url": "https://YOUR_DOMAIN/mcp"` (no need for trailing slash after the nginx fix).

## Local vs production

| Mode | How to run | Public URLs |
|------|------------|-------------|
| **Local pnpm** | `docker compose up -d postgres redis` + `pnpm dev:api` / `pnpm dev:web` | `http://localhost:3001` (API/MCP), `http://localhost:5173` (UI) |
| **Docker Compose** | `docker compose up --build` | **`http://localhost/`** (proxy `:80`) — set `PUBLIC_URL`/`WEB_ORIGIN` to `http://localhost` |
| **VPS** | Actions deploy to `/opt/vaultmcp` | **`http://SERVER_IP/`** (then HTTPS domain) |

## License

Copyright © 2026 Axiler Labs. Released under the GNU Affero General Public License v3.0 only. See [LICENSE](../LICENSE).

# AWS upstream example for VaultMCP

Uses [awslabs.aws-api-mcp-server](https://github.com/awslabs/mcp) via `uvx`. The gateway host needs [`uv`](https://github.com/astral-sh/uv) installed so `uvx` is on `PATH`.

## 1. Store secrets

In the control plane UI (or API), create:

| Secret name | Visibility | Notes |
|-------------|------------|-------|
| `AWS_ACCESS_KEY_ID` | private or workspace | Shared = teammates can use |
| `AWS_SECRET_ACCESS_KEY` | private or workspace | |
| `AWS_REGION` | private or workspace | e.g. `us-east-1` |
| `AWS_SESSION_TOKEN` | optional | Temporary credentials |

## 2. Register upstream

UI → **Integrations** → AWS → **Add**, or POST the JSON in [`aws-upstream.json`](./aws-upstream.json):

```bash
curl -X POST "$API/api/workspaces/$WS_ID/upstreams" \
  -H 'Content-Type: application/json' \
  -b cookies.txt \
  -d @examples/aws-upstream.json
```

Env placeholders like `{{secret:AWS_ACCESS_KEY_ID}}` are resolved only inside the API process when spawning the upstream — never sent to Cursor.

## 3. Cursor config

Local pnpm: `http://localhost:3001/mcp`. Docker / VPS (proxy on port 80): `http://YOUR_SERVER_IP/mcp` (or `https://your.domain/mcp` after TLS).

```json
{
  "mcpServers": {
    "vaultmcp": {
      "url": "http://YOUR_SERVER_IP/mcp"
    }
  }
}
```

No AWS keys in `mcp.json`. See [docs/DEPLOY.md](../docs/DEPLOY.md).

Cursor may show the connection as `user-vaultmcp` in agent logs — that is still VaultMCP. Tool calls look like `aws__…` with descriptions prefixed `[VaultMCP → AWS]`.

## 4. Use from the agent

1. Complete OAuth when Cursor connects to VaultMCP (or use a `vmcp_…` PAT)
2. `list_workspaces` → `use_workspace` with your slug
3. Call namespaced tools `aws__…` (they run through the VaultMCP connection, not a separate AWS MCP host)

## Alternative: HTTP upstream

You can also register an HTTP MCP URL with `headersTemplate` that injects bearer tokens from secrets. Managed AWS MCP (SigV4 / OAuth) is out of scope for v1; prefer the stdio `aws-api-mcp-server` pattern above with vault-injected IAM keys.

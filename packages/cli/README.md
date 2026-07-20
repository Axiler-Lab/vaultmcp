# `@vaultmcp-axiler/cli`

Fetch shared [VaultMCP](https://vaultmcp.dev) workspace secrets and run local commands with them injected into the process environment.

Full guide: [docs/CLI.md](https://github.com/Axiler-Lab/vaultmcp/blob/main/docs/CLI.md) in the open-source repo.

## Quick start

```bash
npx @vaultmcp-axiler/cli@latest login --token vmcp_… --url https://YOUR_HOST
npx @vaultmcp-axiler/cli@latest run -w your-slug -- npm run dev
```

Requires **Node.js 22+**. Use a PAT with the **Runtime env (CLI)** preset (`env` scope only) — not an MCP token.

Prefer `vaultmcp run` over `vaultmcp env` so secrets stay in the child process. Rotate in the dashboard; teammates pick up new values on the next run.

## License

AGPL-3.0-only · [vaultmcp.dev](https://vaultmcp.dev) · [Axiler Labs](https://axiler.com)

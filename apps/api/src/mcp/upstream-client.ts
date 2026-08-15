import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveSecretPlaceholders } from "@vaultmcp/shared";
import type { UpstreamMeta } from "../services/upstreams.js";
import { resolveSecretsForInjection } from "../services/secrets.js";

export type ConnectedUpstream = {
  meta: UpstreamMeta;
  client: Client;
  close: () => Promise<void>;
};

function resolveMap(
  template: Record<string, string>,
  secrets: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(template)) {
    out[k] = resolveSecretPlaceholders(v, secrets);
  }
  return out;
}

/**
 * Open a short-lived connection to an upstream MCP with secrets injected.
 * Credentials never leave this process.
 */
export async function connectUpstream(
  workspaceId: string,
  userId: string,
  meta: UpstreamMeta,
): Promise<ConnectedUpstream> {
  const secretNames = meta.requiredSecrets;
  const secrets = await resolveSecretsForInjection(workspaceId, userId, secretNames);
  const envVars = resolveMap(meta.envTemplate, secrets);
  const headers = resolveMap(meta.headersTemplate, secrets);

  const client = new Client({ name: "vaultmcp-gateway", version: "0.1.0" });

  if (meta.transport === "stdio") {
    if (!meta.command) throw new Error("stdio upstream missing command");
    const transport = new StdioClientTransport({
      command: meta.command,
      args: meta.args,
      // Only pass resolved template vars. The SDK merges a sanitized default
      // environment (PATH/HOME/TERM/…) underneath; inheriting the gateway's
      // full process env here would leak service credentials (master key,
      // database URL) to every spawned upstream.
      env: envVars,
    });
    await client.connect(transport);
    return {
      meta,
      client,
      close: async () => {
        await client.close();
      },
    };
  }

  if (!meta.url) throw new Error("http upstream missing url");
  const transport = new StreamableHTTPClientTransport(new URL(meta.url), {
    requestInit: {
      headers,
    },
  });
  await client.connect(transport);
  return {
    meta,
    client,
    close: async () => {
      await client.close();
    },
  };
}

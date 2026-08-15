import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { resolveSecretPlaceholders, stdioChildEnv, containsCtlChars } from "@vaultmcp/shared";
import type { UpstreamMeta } from "../services/upstreams.js";
import { resolveSecretsForInjection } from "../services/secrets.js";
import { assertSafeUpstreamUrl } from "../net/upstream-url.js";

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
    const resolved = resolveSecretPlaceholders(v, secrets);
    if (containsCtlChars(k) || containsCtlChars(resolved)) {
      throw new Error("Refusing to inject control characters into upstream env/headers");
    }
    out[k] = resolved;
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
    if (process.env.VERCEL) {
      throw new Error("stdio upstreams are not supported on the hosted runtime");
    }
    if (!meta.command) throw new Error("stdio upstream missing command");
    const transport = new StdioClientTransport({
      command: meta.command,
      args: meta.args,
      env: stdioChildEnv(process.env, envVars),
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
  await assertSafeUpstreamUrl(meta.url);
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

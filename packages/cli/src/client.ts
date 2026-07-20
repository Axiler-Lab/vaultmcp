import type { CliConfig } from "./config.js";
import { warnInsecureUrl } from "./config.js";

export type RuntimeEnvResponse = {
  workspace: { id: string; slug: string; name: string };
  secrets: Record<string, string>;
  fetchedAt: string;
};

export async function fetchRuntimeEnv(
  cfg: CliConfig,
  opts: { workspace: string; names?: string[] },
): Promise<RuntimeEnvResponse> {
  warnInsecureUrl(cfg.url);
  const params = new URLSearchParams();
  params.set("workspace", opts.workspace);
  if (opts.names?.length) {
    params.set("names", opts.names.join(","));
  }
  const endpoint = `${cfg.url}/api/runtime/v1/env?${params.toString()}`;
  const res = await fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: "application/json",
    },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || "invalid_response" };
  }

  if (!res.ok) {
    const err = body as { error?: string; message?: string };
    const msg = err.message || err.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  const data = body as RuntimeEnvResponse;
  if (!data.secrets || typeof data.secrets !== "object") {
    throw new Error("invalid runtime env response");
  }
  return data;
}

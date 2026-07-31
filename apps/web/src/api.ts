const rawApiUrl = (import.meta.env.VITE_API_URL ?? "").trim();
/**
 * Browser → API origin. Empty = same-origin (local Vite proxy / Compose).
 * Reject Vercel "Sensitive" placeholders and non-URL values so login never
 * becomes a relative path like `[SENSITIVE]/auth/github` (nested URL loops).
 */
const API_BASE =
  rawApiUrl &&
  rawApiUrl !== "[SENSITIVE]" &&
  /^https?:\/\//i.test(rawApiUrl)
    ? rawApiUrl.replace(/\/$/, "")
    : "";

export type User = {
  id: string;
  githubLogin: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  defaultWorkspaceId: string | null;
  totpEnabled?: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error((body as { error?: string }).error ?? res.statusText) as Error & {
      code?: string;
    };
    err.code = (body as { error?: string }).error;
    throw err;
  }
  return res.json() as Promise<T>;
}

/** Abort a request if the gateway is slow/unreachable so the landing can still render. */
function withTimeout(ms: number, signal?: AbortSignal | null): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const onAbort = () => {
    clearTimeout(timer);
    ctrl.abort();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  ctrl.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
    { once: true },
  );
  return ctrl.signal;
}

export const api = {
  me: (init?: RequestInit) =>
    request<{ user: User; mfaRequired: boolean; mfaSatisfied: boolean }>("/auth/me", {
      ...init,
      signal: withTimeout(4000, init?.signal),
    }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  mfaStatus: () => request<{ enabled: boolean; mfaSatisfied: boolean }>("/auth/mfa"),
  mfaSetup: () =>
    request<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup", { method: "POST" }),
  mfaConfirm: (code: string) =>
    request<{ ok: boolean; enabled: boolean }>("/auth/mfa/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  mfaVerify: (code: string) =>
    request<{ ok: boolean }>("/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  mfaDisable: (code: string) =>
    request<{ ok: boolean; enabled: boolean }>("/auth/mfa/disable", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  config: () =>
    request<{
      publicUrl: string;
      mcpUrl: string;
      cursorConfig: { mcpServers: Record<string, { url: string }> };
    }>("/api/config"),
  listWorkspaces: () =>
    request<{
      workspaces: Array<{
        id: string;
        name: string;
        slug: string;
        role: string;
        createdAt: string;
      }>;
    }>("/api/workspaces"),
  createWorkspace: (body: { name: string; slug: string }) =>
    request<{ workspace: { id: string; name: string; slug: string } }>("/api/workspaces", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getWorkspace: (id: string) =>
    request<{
      workspace: { id: string; name: string; slug: string };
      role: string;
    }>(`/api/workspaces/${id}`),
  setDefault: (id: string) =>
    request<{ ok: boolean; user: User }>(`/api/workspaces/${id}/default`, { method: "POST" }),
  deleteWorkspace: (id: string) =>
    request<{ ok: boolean; user: User }>(`/api/workspaces/${id}`, { method: "DELETE" }),
  listMembers: (id: string) =>
    request<{
      members: Array<{
        id: string;
        role: string;
        userId: string;
        githubLogin: string;
        name: string | null;
        avatarUrl: string | null;
      }>;
    }>(`/api/workspaces/${id}/members`),
  inviteMember: (id: string, body: { githubLogin: string; role: string }) =>
    request(`/api/workspaces/${id}/members`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  removeMember: (id: string, memberId: string) =>
    request(`/api/workspaces/${id}/members/${memberId}`, { method: "DELETE" }),
  listSecrets: (id: string) =>
    request<{
      secrets: Array<{
        id: string;
        name: string;
        visibility: string;
        tags: string[];
        createdByUserId: string;
        updatedAt: string;
      }>;
    }>(`/api/workspaces/${id}/secrets`),
  createSecret: (
    id: string,
    body: { name: string; value: string; visibility: string; tags?: string[] },
  ) =>
    request(`/api/workspaces/${id}/secrets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteSecret: (id: string, secretId: string) =>
    request(`/api/workspaces/${id}/secrets/${secretId}`, { method: "DELETE" }),
  listUpstreams: (id: string) =>
    request<{
      upstreams: Array<{
        id: string;
        name: string;
        slug: string;
        transport: string;
        command: string | null;
        args: string[];
        url: string | null;
        envTemplate: Record<string, string>;
        enabled: boolean;
        requiredSecrets: string[];
      }>;
    }>(`/api/workspaces/${id}/upstreams`),
  createUpstream: (id: string, body: Record<string, unknown>) =>
    request(`/api/workspaces/${id}/upstreams`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  deleteUpstream: (id: string, upstreamId: string) =>
    request(`/api/workspaces/${id}/upstreams/${upstreamId}`, { method: "DELETE" }),
  listAudit: (id: string) =>
    request<{
      logs: Array<{
        id: string;
        action: string;
        upstreamSlug: string | null;
        toolName: string | null;
        allowed: boolean;
        createdAt: string;
      }>;
    }>(`/api/workspaces/${id}/audit`),
  listTokens: () =>
    request<{
      tokens: Array<{
        id: string;
        name: string;
        tokenPrefix: string;
        scopes: string[];
        expiresAt: string | null;
        createdAt: string;
        lastUsedAt: string | null;
      }>;
    }>("/api/tokens"),
  createToken: (body?: {
    name?: string;
    scopes?: string[];
    expiresInDays?: number;
    expiresAt?: string;
  }) =>
    request<{
      token: {
        id: string;
        name: string;
        tokenPrefix: string;
        scopes: string[];
        expiresAt: string | null;
        createdAt: string;
        lastUsedAt: string | null;
        secret: string;
      };
    }>("/api/tokens", {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  revokeToken: (id: string) => request<{ ok: boolean }>(`/api/tokens/${id}`, { method: "DELETE" }),
};

export function loginUrl() {
  const returnTo = encodeURIComponent(`${window.location.origin}/`);
  // Leading slash keeps the path absolute on the API host (or same-origin).
  return `${API_BASE}/auth/github?returnTo=${returnTo}`;
}

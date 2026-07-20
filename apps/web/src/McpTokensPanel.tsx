import { useEffect, useState } from "react";
import {
  CheckIcon,
  ClipboardDocumentIcon,
  ClockIcon,
  KeyIcon,
  ShieldCheckIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { DEFAULT_ENV_TOKEN_EXPIRY_DAYS, MCP_CLIENT_SERVER_KEY } from "@vaultmcp/shared";
import { api } from "./api";

type TokenRow = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

type TokenPreset = "mcp-rw" | "mcp-ro" | "env";

const EXPIRY_OPTIONS = [
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
  { label: "365 days", days: 365 },
] as const;

function tokenConfigJson(mcpUrl: string, secret: string) {
  return JSON.stringify(
    {
      mcpServers: {
        [MCP_CLIENT_SERVER_KEY]: {
          url: mcpUrl,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    },
    null,
    2,
  );
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Never expires";
  const at = new Date(expiresAt);
  const ms = at.getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  if (days <= 1) return "Expires today";
  return `${days} days left`;
}

function scopesLabel(scopes: string[]): string {
  const hasWrite = scopes.includes("write");
  const hasRead = scopes.includes("read");
  const hasEnv = scopes.includes("env");
  if (hasEnv && !hasRead && !hasWrite) return "Runtime env";
  const parts: string[] = [];
  if (hasRead && hasWrite) parts.push("Read + write");
  else if (hasRead) parts.push("Read-only");
  if (hasEnv) parts.push("env");
  return parts.join(" · ") || scopes.join(", ") || "—";
}

function scopesForPreset(preset: TokenPreset): string[] {
  if (preset === "env") return ["env"];
  if (preset === "mcp-ro") return ["read"];
  return ["read", "write"];
}

export function McpTokensPanel({
  mcpUrl,
  mode = "all",
  onNotice,
  onError,
  onTokensChange,
}: {
  mcpUrl: string;
  /** Restrict create form: MCP scopes, env-only, or all presets. */
  mode?: "all" | "mcp" | "env";
  onNotice?: (message: string) => void;
  onError?: (message: string) => void;
  onTokensChange?: (count: number) => void;
}) {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [preset, setPreset] = useState<TokenPreset>(mode === "env" ? "env" : "mcp-rw");
  const [expiresInDays, setExpiresInDays] = useState(
    mode === "env" ? DEFAULT_ENV_TOKEN_EXPIRY_DAYS : 90,
  );
  const [tokenBusy, setTokenBusy] = useState(false);
  const [newTokenSecret, setNewTokenSecret] = useState<string | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const [configCopied, setConfigCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const displayError = localError;
  const displayNotice = localNotice;
  const showLocalFeedback = !onNotice && !onError;
  const isEnvMode = mode === "env" || preset === "env";
  const showMcpScopes = mode === "all" || mode === "mcp";
  const showEnvScope = mode === "all" || mode === "env";

  useEffect(() => {
    if (mode === "env") {
      setPreset("env");
      setExpiresInDays(DEFAULT_ENV_TOKEN_EXPIRY_DAYS);
    } else if (mode === "mcp" && preset === "env") {
      setPreset("mcp-rw");
      setExpiresInDays(90);
    }
  }, [mode]);

  function reportError(message: string) {
    setLocalError(message);
    setLocalNotice(null);
    onError?.(message);
  }

  function reportNotice(message: string) {
    setLocalNotice(message);
    setLocalError(null);
    onNotice?.(message);
  }

  async function refreshTokens() {
    const list = await api.listTokens();
    setTokens(list.tokens);
    onTokensChange?.(list.tokens.length);
  }

  useEffect(() => {
    setLoading(true);
    refreshTokens()
      .catch((e) => reportError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function createApiToken(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setTokenBusy(true);
    try {
      const scopes = scopesForPreset(preset);
      const res = await api.createToken({
        name: tokenName.trim() || (preset === "env" ? "Dev laptop" : "MCP token"),
        scopes,
        expiresInDays,
      });
      setNewTokenSecret(res.token.secret);
      setTokenName("");
      await refreshTokens();
      reportNotice("Token created — copy it now. It will not be shown again.");
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    } finally {
      setTokenBusy(false);
    }
  }

  async function revokeApiToken(id: string) {
    if (!window.confirm("Revoke this token? Clients using it will lose access immediately.")) {
      return;
    }
    setLocalError(null);
    try {
      await api.revokeToken(id);
      if (newTokenSecret) setNewTokenSecret(null);
      await refreshTokens();
      reportNotice("Token revoked.");
    } catch (err) {
      reportError(err instanceof Error ? err.message : String(err));
    }
  }

  async function copyTokenSecret() {
    if (!newTokenSecret) return;
    await navigator.clipboard.writeText(newTokenSecret);
    setTokenCopied(true);
    window.setTimeout(() => setTokenCopied(false), 1600);
  }

  async function copyConfig() {
    const secret = newTokenSecret ?? "vmcp_YOUR_TOKEN";
    await navigator.clipboard.writeText(tokenConfigJson(mcpUrl, secret));
    setConfigCopied(true);
    window.setTimeout(() => setConfigCopied(false), 1600);
  }

  const configSnippet = tokenConfigJson(mcpUrl, newTokenSecret ?? "vmcp_YOUR_TOKEN");
  const apiBase = mcpUrl.replace(/\/mcp\/?$/, "");

  return (
    <section className="panel tokens-panel">
      <header className="tokens-panel-head">
        <div className="tokens-panel-icon" aria-hidden>
          <KeyIcon />
        </div>
        <div className="tokens-panel-titling">
          <h2>{mode === "env" ? "Runtime env token" : "Create a token"}</h2>
          <p className="muted">
            {mode === "env" ? (
              <>
                Env-scoped <span className="mono">vmcp_…</span> for{" "}
                <span className="mono">vaultmcp run</span>. Shown once.
              </>
            ) : (
              <>
                Issue a <span className="mono">vmcp_…</span> credential. Shown once; we store a hash
                only.
              </>
            )}
          </p>
        </div>
      </header>

      {showLocalFeedback && displayError && (
        <p className="error banner-alert" role="alert">
          {displayError}
        </p>
      )}
      {showLocalFeedback && displayNotice && (
        <p className="notice" role="status" aria-live="polite">
          {displayNotice}
        </p>
      )}

      <div className="tokens-grid">
        <article className="token-card token-card-create">
          <div className="token-card-head">
            <h3>Create</h3>
            <p className="muted">Name, scope, and lifetime.</p>
          </div>
          <form className="token-create-form" onSubmit={(e) => void createApiToken(e)}>
            <div className="fields-row fields-row-asymmetric token-create-fields">
              <label className="field token-field">
                <span className="field-label">
                  Name <span className="field-hint">(optional)</span>
                </span>
                <input
                  value={tokenName}
                  onChange={(e) => setTokenName(e.target.value)}
                  placeholder={mode === "env" ? "Dev laptop" : "Cursor laptop"}
                  maxLength={120}
                  autoComplete="off"
                />
              </label>
              <label className="field token-field">
                <span className="field-label">Expires in</span>
                <select
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Number(e.target.value))}
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.days} value={opt.days}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {(showMcpScopes || showEnvScope) && mode === "all" && (
              <fieldset className="token-scope-fieldset">
                <legend className="field-label">Scope</legend>
                <div
                  className="token-scope-options token-scope-options-3"
                  role="radiogroup"
                  aria-label="Token scope"
                >
                  <button
                    type="button"
                    className={`token-scope-option ${preset === "mcp-ro" ? "active" : ""}`}
                    aria-pressed={preset === "mcp-ro"}
                    onClick={() => setPreset("mcp-ro")}
                  >
                    <ShieldCheckIcon aria-hidden />
                    <span className="token-scope-option-title">MCP read-only</span>
                    <span className="token-scope-option-desc">List workspaces & call tools</span>
                  </button>
                  <button
                    type="button"
                    className={`token-scope-option ${preset === "mcp-rw" ? "active" : ""}`}
                    aria-pressed={preset === "mcp-rw"}
                    onClick={() => setPreset("mcp-rw")}
                  >
                    <KeyIcon aria-hidden />
                    <span className="token-scope-option-title">MCP read + write</span>
                    <span className="token-scope-option-desc">Also put_secret & integrations</span>
                  </button>
                  <button
                    type="button"
                    className={`token-scope-option ${preset === "env" ? "active" : ""}`}
                    aria-pressed={preset === "env"}
                    onClick={() => {
                      setPreset("env");
                      setExpiresInDays(DEFAULT_ENV_TOKEN_EXPIRY_DAYS);
                      if (!tokenName.trim()) setTokenName("Dev laptop");
                    }}
                  >
                    <ClockIcon aria-hidden />
                    <span className="token-scope-option-title">Runtime env (CLI)</span>
                    <span className="token-scope-option-desc">
                      env scope · vaultmcp run (not for /mcp)
                    </span>
                  </button>
                </div>
              </fieldset>
            )}

            {mode === "mcp" && (
              <fieldset className="token-scope-fieldset">
                <legend className="field-label">Scope</legend>
                <div className="token-scope-options" role="radiogroup" aria-label="MCP token scope">
                  <button
                    type="button"
                    className={`token-scope-option ${preset === "mcp-ro" ? "active" : ""}`}
                    aria-pressed={preset === "mcp-ro"}
                    onClick={() => setPreset("mcp-ro")}
                  >
                    <ShieldCheckIcon aria-hidden />
                    <span className="token-scope-option-title">Read-only</span>
                    <span className="token-scope-option-desc">List workspaces & call tools</span>
                  </button>
                  <button
                    type="button"
                    className={`token-scope-option ${preset === "mcp-rw" ? "active" : ""}`}
                    aria-pressed={preset === "mcp-rw"}
                    onClick={() => setPreset("mcp-rw")}
                  >
                    <KeyIcon aria-hidden />
                    <span className="token-scope-option-title">Read + write</span>
                    <span className="token-scope-option-desc">Also put_secret & integrations</span>
                  </button>
                </div>
              </fieldset>
            )}

            {mode === "env" && (
              <p className="token-env-scope-note muted">
                Scope fixed to <span className="mono">env</span> — for CLI only, not{" "}
                <span className="mono">/mcp</span>.
              </p>
            )}

            <div className="token-create-actions">
              <button className="btn btn-primary" type="submit" disabled={tokenBusy}>
                {tokenBusy ? "Creating…" : "Create token"}
              </button>
            </div>
          </form>
        </article>

        <article className="token-card token-card-config">
          <div className="token-card-head">
            <h3>{isEnvMode ? "CLI login" : "Client config"}</h3>
            <p className="muted">
              {isEnvMode ? (
                <>
                  Prefer <span className="mono">vaultmcp run</span>. See{" "}
                  <a href="/docs#local-env">Docs → Local env</a>.
                </>
              ) : newTokenSecret ? (
                "Ready to paste into ~/.cursor/mcp.json."
              ) : (
                <>
                  Template — replace <span className="mono">vmcp_YOUR_TOKEN</span> after create.
                </>
              )}
            </p>
          </div>
          {isEnvMode ? (
            <div className="code-block token-config-block">
              <button
                type="button"
                className="btn copy-btn"
                onClick={() => {
                  const tok = newTokenSecret ?? "vmcp_YOUR_TOKEN";
                  const cmd = `npx @vaultmcp-axiler/cli@latest login --token ${tok} --url ${apiBase}\nnpx @vaultmcp-axiler/cli@latest run -w YOUR_SLUG -- npm run dev`;
                  void navigator.clipboard.writeText(cmd).then(() => {
                    setConfigCopied(true);
                    window.setTimeout(() => setConfigCopied(false), 1600);
                  });
                }}
              >
                <ClipboardDocumentIcon className="btn-icon" aria-hidden />
                {configCopied ? "Copied" : "Copy"}
              </button>
              {`npx @vaultmcp-axiler/cli@latest login --token ${newTokenSecret ?? "vmcp_YOUR_TOKEN"} --url ${apiBase}
npx @vaultmcp-axiler/cli@latest run -w YOUR_SLUG -- npm run dev`}
            </div>
          ) : (
            <div className="code-block token-config-block">
              <button type="button" className="btn copy-btn" onClick={() => void copyConfig()}>
                <ClipboardDocumentIcon className="btn-icon" aria-hidden />
                {configCopied ? "Copied" : "Copy"}
              </button>
              {configSnippet}
            </div>
          )}
        </article>

        {newTokenSecret && (
          <article className="token-card token-card-reveal" role="status" aria-live="polite">
            <div className="token-card-head">
              <p className="token-reveal-kicker">
                <CheckIcon aria-hidden /> Secret ready
              </p>
              <h3>Copy the token now — shown once</h3>
              <p className="muted">We cannot show this secret again after you leave this page.</p>
            </div>
            <div className="token-secret-block mono">{newTokenSecret}</div>
            <div className="token-card-actions">
              <button type="button" className="btn btn-primary" onClick={() => void copyTokenSecret()}>
                <ClipboardDocumentIcon className="btn-icon" aria-hidden />
                {tokenCopied ? "Copied" : "Copy token"}
              </button>
              {!isEnvMode && (
                <button type="button" className="btn" onClick={() => void copyConfig()}>
                  <ClipboardDocumentIcon className="btn-icon" aria-hidden />
                  {configCopied ? "Config copied" : "Copy Cursor config"}
                </button>
              )}
            </div>
          </article>
        )}

        <article className="token-card token-card-list">
          <div className="token-card-head token-card-head-row">
            <div>
              <h3>Active tokens</h3>
              <p className="muted">Revoke anytime. Expired tokens stop authenticating.</p>
            </div>
            {!loading && tokens.length > 0 && (
              <span className="token-count-pill" aria-label={`${tokens.length} tokens`}>
                {tokens.length}
              </span>
            )}
          </div>

          {loading ? (
            <p className="muted token-loading">Loading tokens…</p>
          ) : tokens.length === 0 ? (
            <div className="empty-state empty-state-compact">
              <div className="empty-state-icon" aria-hidden>
                <KeyIcon />
              </div>
              <p className="empty-state-title">No active tokens</p>
              <p className="empty-state-body">
                Create one to connect an IDE without a browser OAuth step.
              </p>
            </div>
          ) : (
            <div className="table-wrap token-table-wrap">
              <table className="token-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Scope</th>
                    <th>Expires</th>
                    <th>Last used</th>
                    <th>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((t) => {
                    const expired = isExpired(t.expiresAt);
                    return (
                      <tr key={t.id} className={expired ? "token-row-expired" : undefined}>
                        <td>
                          <strong>{t.name}</strong>
                          {expired ? <span className="badge badge-expired">Expired</span> : null}
                          <div className="token-item-prefix mono">{t.tokenPrefix}…</div>
                        </td>
                        <td>{scopesLabel(t.scopes ?? ["read", "write"])}</td>
                        <td>{expiryLabel(t.expiresAt)}</td>
                        <td className="muted">
                          {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleDateString() : "never"}
                        </td>
                        <td className="td-actions">
                          <button
                            type="button"
                            className="btn btn-table-action"
                            aria-label={`Revoke token ${t.name}`}
                            onClick={() => void revokeApiToken(t.id)}
                          >
                            <TrashIcon className="btn-icon" aria-hidden />
                            Revoke
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

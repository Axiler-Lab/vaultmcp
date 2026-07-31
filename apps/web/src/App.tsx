import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  ClipboardDocumentIcon,
  CommandLineIcon,
  KeyIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { api, loginUrl, type User } from "./api";
import { Dock } from "./Dock";
import { DocsPage } from "./DocsPage";
import { AppShell, Aurora, GITHUB_REPO_URL, SiteNav } from "./Layout";
import { McpTokensPanel } from "./McpTokensPanel";
import { MfaGate, MfaSettingsPanel } from "./MfaPanel";
import { ProductPage } from "./ProductPage";
import { WorkspacePage } from "./WorkspacePage";

function GitHubMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.584 2 12.253c0 4.526 2.865 8.363 6.839 9.718.5.094.682-.222.682-.48 0-.237-.009-.866-.014-1.7-2.782.618-3.369-1.372-3.369-1.372-.454-1.178-1.11-1.492-1.11-1.492-.908-.635.069-.622.069-.622 1.004.072 1.532 1.055 1.532 1.055.892 1.563 2.341 1.112 2.91.85.092-.663.35-1.112.636-1.368-2.22-.259-4.555-1.137-4.555-5.06 0-1.118.39-2.033 1.03-2.75-.103-.26-.447-1.3.098-2.71 0 0 .84-.275 2.75 1.05A9.35 9.35 0 0 1 12 6.926c.85.004 1.705.117 2.504.344 1.909-1.325 2.747-1.05 2.747-1.05.547 1.41.203 2.45.1 2.71.64.717 1.028 1.632 1.028 2.75 0 3.933-2.338 4.798-4.566 5.052.359.317.679.943.679 1.902 0 1.373-.012 2.48-.012 2.817 0 .26.18.58.688.48A10.27 10.27 0 0 0 22 12.253C22 6.584 17.523 2 12 2z" />
    </svg>
  );
}

const LANDING_FEATURES = [
  {
    title: "Envelope-encrypted vault",
    body: "AES-256-GCM per workspace. Each vault has its own key; values are write-only and never shown back in the UI or to the agent.",
    icon: LockClosedIcon,
  },
  {
    title: "Team workspaces",
    body: "Share staging AWS with eng; keep personal Anthropic keys private. Invite by GitHub login.",
    icon: UserGroupIcon,
  },
  {
    title: "One MCP URL",
    body: "Point any MCP client at VaultMCP. Upstream tools show up as aws__, github__, and more.",
    icon: CommandLineIcon,
  },
];

const HOW_STEPS = [
  {
    title: "Save keys in VaultMCP",
    body: "Create a workspace and store API keys. Values are envelope-encrypted at rest and never returned in lists.",
  },
  {
    title: "Wire upstreams to names",
    body: "Register AWS or other MCPs with {{secret:NAME}}. No real tokens in client settings.",
  },
  {
    title: "Connect your IDE once",
    body: "Add the VaultMCP URL, sign in with GitHub, pick a workspace, call tools as usual.",
  },
];

const BEFORE_AFTER = [
  {
    topic: "Where the secret lives",
    without: "In each IDE config, .env, or paste into chat",
    with: "Only in the vault (encrypted)",
  },
  {
    topic: "What the IDE stores",
    without: "Provider keys and tokens",
    with: "Just the VaultMCP URL",
  },
  {
    topic: "Rotating a leaked key",
    without: "Update every machine and config file",
    with: "Update once in the vault",
  },
  {
    topic: "Sharing staging AWS",
    without: "Slack DMs, shared docs, drift",
    with: "One shared workspace secret",
  },
];

function LoginPage() {
  return (
    <div className="app-root">
      <Aurora />
      <SiteNav />
      <main className="landing">
        <section className="hero">
          <div className="hero-inner">
            <p className="hero-kicker"># keep secrets out of the IDE</p>
            <p className="hero-brand">
              Vault<span>MCP</span>
            </p>
            <h1>
              The credential vault for AI coding agents. Private or shared, never pasted into your
              tools.
            </h1>
            <p className="hero-lead">
              Connect any MCP-compatible IDE once. Anthropic, AWS, GitHub and the rest inject
              server-side from encrypted workspace secrets.
            </p>
            <div className="hero-cta">
              <a className="btn btn-primary btn-lg" href={loginUrl()}>
                <GitHubMark className="btn-icon" />
                Get started
              </a>
              <a
                className="btn btn-ghost btn-lg"
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <GitHubMark className="btn-icon" />
                Open source
              </a>
              <Link className="link-quiet" to="/product">
                See how a secret travels <ArrowRightIcon className="btn-icon" aria-hidden />
              </Link>
            </div>
            <div className="hero-clients" aria-label="Works with MCP-compatible clients">
              <p className="hero-clients-label">Works with any MCP client</p>
              <ul className="client-logos">
                {[
                  { name: "Claude Desktop", src: "/logos/claude.svg" },
                  { name: "VS Code", src: "/logos/vscode.svg" },
                  { name: "Cursor", src: "/logos/cursor.svg" },
                  { name: "Windsurf", src: "/logos/windsurf.svg" },
                  { name: "Zed", src: "/logos/zed.svg" },
                ].map((client) => (
                  <li key={client.name} className="client-logo">
                    <span className="client-logo-mark" title={client.name}>
                      <img src={client.src} alt="" width={22} height={22} />
                    </span>
                    <span className="client-logo-name">{client.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="landing-features" id="product" aria-label="Highlights">
          <div className="landing-features-inner">
            <header className="landing-features-head">
              <p className="section-label">Why VaultMCP</p>
              <h2>Secrets stay on the server. Agents only see results.</h2>
            </header>
            <div className="feature-strip">
              {LANDING_FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <article key={f.title} className="feature">
                    <div className="feature-icon">
                      <Icon aria-hidden />
                    </div>
                    <h3>{f.title}</h3>
                    <p>{f.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="landing-how" aria-label="How it works">
          <div className="landing-section-inner">
            <header className="landing-features-head">
              <p className="section-label">
                <ArrowPathIcon className="inline-icon" aria-hidden /> How it works
              </p>
              <h2>Three steps. That’s the whole setup.</h2>
            </header>
            <ol className="how-steps">
              {HOW_STEPS.map((step, i) => (
                <li key={step.title} className="how-step">
                  <span className="how-step-num">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-compare" aria-label="Before and after">
          <div className="landing-section-inner">
            <header className="landing-features-head">
              <p className="section-label">
                <ShieldCheckIcon className="inline-icon" aria-hidden /> Before / after
              </p>
              <h2>Same IDE. Keys stop living in the IDE.</h2>
              <p>
                Without a vault, every machine holds copies of provider keys. With VaultMCP, the IDE
                only knows the gateway URL.
              </p>
            </header>
            <div className="compare-table panel">
              <div className="compare-table-head">
                <span>Topic</span>
                <span>Without VaultMCP</span>
                <span>With VaultMCP</span>
              </div>
              {BEFORE_AFTER.map((row) => (
                <div key={row.topic} className="compare-table-row">
                  <strong>{row.topic}</strong>
                  <span className="compare-without">{row.without}</span>
                  <span className="compare-with">{row.with}</span>
                </div>
              ))}
            </div>
            <div className="landing-cta-row">
              <Link className="btn btn-primary btn-lg" to="/product">
                Watch a secret travel the loop <ArrowRightIcon className="btn-icon" aria-hidden />
              </Link>
              <a className="btn btn-ghost" href={loginUrl()}>
                Sign in with GitHub
              </a>
            </div>
          </div>
        </section>
      </main>
      <Dock user={null} />
    </div>
  );
}


function Home({
  user,
  onLogout,
  onUserUpdate,
}: {
  user: User;
  onLogout: () => void;
  onUserUpdate: (user: User) => void;
}) {
  const [workspaces, setWorkspaces] = useState<
    Array<{ id: string; name: string; slug: string; role: string }>
  >([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<{ mcpUrl: string; cursorConfig: unknown } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [connectPath, setConnectPath] = useState<"oauth" | "token" | null>(null);
  const [tokenSubPath, setTokenSubPath] = useState<"mcp" | "env">("mcp");

  async function refresh() {
    const [ws, cfg] = await Promise.all([api.listWorkspaces(), api.config()]);
    setWorkspaces(ws.workspaces);
    setConfig(cfg);
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function createWorkspace(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createWorkspace({ name, slug });
      setName("");
      setSlug("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function deleteWorkspace(w: { id: string; name: string }) {
    if (
      !window.confirm(
        `Delete workspace "${w.name}"? This permanently removes its secrets, upstreams, and memberships.`,
      )
    ) {
      return;
    }
    setError(null);
    setDeletingId(w.id);
    try {
      const res = await api.deleteWorkspace(w.id);
      setWorkspaces((prev) => prev.filter((x) => x.id !== w.id));
      onUserUpdate(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  }

  async function copyConfig() {
    if (!config) return;
    await navigator.clipboard.writeText(JSON.stringify(config.cursorConfig, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <AppShell user={user} onLogout={onLogout}>
      <main className="shell">
        <header className="page-header" id="workspaces">
          <p className="section-label">Control plane</p>
          <h1>Workspaces</h1>
          <p>
            Organize Anthropic, AWS, GitHub and other keys by team or environment. Your IDE connects
            only to VaultMCP.
          </p>
        </header>

        <div className="grid grid-2">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Your workspaces</h2>
                <p className="muted">
                  Containers for secrets, upstream MCPs, and members. Owners can delete from here.
                </p>
              </div>
              {workspaces.length > 0 && (
                <span className="panel-count" aria-label={`${workspaces.length} workspaces`}>
                  {workspaces.length}
                </span>
              )}
            </div>
            {error && (
              <p className="error banner-alert" role="alert">
                {error}
              </p>
            )}
            {workspaces.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon" aria-hidden>
                  <UserGroupIcon />
                </div>
                <p className="empty-state-title">No workspaces yet</p>
                <p className="empty-state-body">
                  Create one to store your first secrets and connect an IDE.
                </p>
                <button
                  type="button"
                  className="btn"
                  onClick={() => document.getElementById("create-ws-name")?.focus()}
                >
                  Create a workspace
                </button>
              </div>
            ) : (
              <div className="stack">
                {workspaces.map((w) => {
                  const isOwner = w.role === "owner";
                  const busy = deletingId === w.id;
                  return (
                    <div key={w.id} className="ws-row">
                      <Link className="ws-link" to={`/workspaces/${w.id}`}>
                        <strong>
                          {w.name}
                          {user.defaultWorkspaceId === w.id && (
                            <span className="badge badge-default">Default</span>
                          )}
                        </strong>
                        <span className="mono">
                          {w.slug} · {w.role}
                        </span>
                      </Link>
                      {isOwner && (
                        <button
                          type="button"
                          className="btn btn-danger btn-danger-quiet ws-delete"
                          disabled={busy || deletingId !== null}
                          aria-label={`Delete workspace ${w.name}`}
                          title="Delete workspace"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void deleteWorkspace(w);
                          }}
                        >
                          <TrashIcon className="btn-icon" aria-hidden />
                          {busy ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="panel create-ws-panel">
            <div className="panel-head">
              <div>
                <h2>Create workspace</h2>
                <p className="muted">Slug: lowercase letters, numbers, hyphens.</p>
              </div>
            </div>
            <form className="stack create-ws-form" onSubmit={createWorkspace}>
              <div className="fields-row">
                <label className="field">
                  <span className="field-label">
                    Name<span className="req" aria-hidden>
                      *
                    </span>
                  </span>
                  <input
                    id="create-ws-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Acme staging"
                    required
                  />
                </label>
                <label className="field">
                  <span className="field-label">
                    Slug<span className="req" aria-hidden>
                      *
                    </span>
                  </span>
                  <input
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    pattern="[-a-z0-9]+"
                    placeholder="acme-staging"
                    required
                  />
                </label>
              </div>
              <button className="btn btn-primary" type="submit">
                Create workspace
              </button>
            </form>
          </section>
        </div>

        {config && (
          <div className="connect-layout connect-layout-v2 home-connect" id="clients">
            <section className="panel connect-hero-panel">
              <div className="connect-hero-top">
                <div>
                  <p className="section-label">Connect</p>
                  <h2>Point your IDE at VaultMCP</h2>
                  <p className="muted connect-lede">
                    Choose OAuth or a personal token. Keep the config key{" "}
                    <span className="mono">vaultmcp</span>.
                  </p>
                </div>
                <Link className="btn btn-ghost connect-docs-btn" to="/docs#clients">
                  Full guide
                </Link>
              </div>

              <div className="connect-choice-grid" role="group" aria-label="Authentication method">
                <button
                  type="button"
                  className={`connect-choice ${connectPath === "oauth" ? "active" : ""}`}
                  aria-pressed={connectPath === "oauth"}
                  onClick={() => setConnectPath("oauth")}
                >
                  <ShieldCheckIcon className="connect-choice-icon" aria-hidden />
                  <span className="connect-choice-title">Connect with OAuth</span>
                  <span className="connect-choice-desc">
                    URL only. IDE opens a browser for GitHub sign-in.
                  </span>
                </button>
                <button
                  type="button"
                  className={`connect-choice ${connectPath === "token" ? "active" : ""}`}
                  aria-pressed={connectPath === "token"}
                  onClick={() => setConnectPath("token")}
                >
                  <KeyIcon className="connect-choice-icon" aria-hidden />
                  <span className="connect-choice-title">Use a token</span>
                  <span className="connect-choice-desc">
                    PAT for MCP headers, or Runtime env for the CLI.
                  </span>
                </button>
              </div>
            </section>

            {connectPath === "oauth" && (
              <section className="panel connect-method-panel connect-reveal">
                <div className="panel-head">
                  <div>
                    <p className="section-label">OAuth</p>
                    <h2>Client config</h2>
                    <p className="muted">
                      Paste into <span className="mono">~/.cursor/mcp.json</span>, reload MCP, then
                      complete browser Connect.
                    </p>
                  </div>
                </div>
                <div className="code-block">
                  <button type="button" className="btn copy-btn" onClick={() => void copyConfig()}>
                    <ClipboardDocumentIcon className="btn-icon" aria-hidden />
                    {copied ? "Copied" : "Copy"}
                  </button>
                  {JSON.stringify(config.cursorConfig, null, 2)}
                </div>
                <p className="connect-meta">
                  MCP URL: <span className="mono">{config.mcpUrl}</span>
                </p>
              </section>
            )}

            {connectPath === "token" && (
              <div className="connect-token-flow connect-reveal">
                <div className="connect-token-subs" role="tablist" aria-label="Token type">
                  <button
                    type="button"
                    role="tab"
                    className={`connect-token-sub ${tokenSubPath === "mcp" ? "active" : ""}`}
                    aria-selected={tokenSubPath === "mcp"}
                    onClick={() => setTokenSubPath("mcp")}
                  >
                    MCP client
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={`connect-token-sub ${tokenSubPath === "env" ? "active" : ""}`}
                    aria-selected={tokenSubPath === "env"}
                    onClick={() => setTokenSubPath("env")}
                  >
                    Runtime env (CLI)
                  </button>
                </div>
                {tokenSubPath === "env" && (
                  <aside className="connect-env-card" aria-label="Runtime env example">
                    <div>
                      <p className="section-label">Local env</p>
                      <h3>Inject secrets into a process</h3>
                      <p className="muted">
                        Prefer <span className="mono">vaultmcp run</span> over printing dotenv files.
                      </p>
                    </div>
                    <div className="code-block">
                      {`npx @vaultmcp-axiler/cli@latest run -w YOUR_SLUG -- npm run dev`}
                    </div>
                    <Link className="connect-env-link" to="/docs#local-env">
                      Docs → Local env / CLI
                    </Link>
                  </aside>
                )}
                <McpTokensPanel
                  mcpUrl={config.mcpUrl}
                  mode={tokenSubPath === "env" ? "env" : "mcp"}
                />
              </div>
            )}

            {connectPath === null && (
              <p className="connect-pick-hint muted">
                Choose OAuth or a token above to see config and next steps.
              </p>
            )}
          </div>
        )}

        <MfaSettingsPanel
          enabled={Boolean(user.totpEnabled)}
          onChanged={(enabled) => onUserUpdate({ ...user, totpEnabled: enabled })}
        />
      </main>
      <Dock user={user} />
    </AppShell>
  );
}

function WorkspaceRoute({
  user,
  onLogout,
  onUserUpdate,
}: {
  user: User;
  onLogout: () => void;
  onUserUpdate: (user: User) => void;
}) {
  const { id } = useParams();
  if (!id) return <Navigate to="/" replace />;
  return (
    <WorkspacePage
      user={user}
      workspaceId={id}
      onLogout={onLogout}
      onUserUpdate={onUserUpdate}
    />
  );
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((r) => {
        if (cancelled) return;
        setUser(r.user);
        setMfaRequired(Boolean(r.mfaRequired));
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setMfaRequired(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    await api.logout().catch(() => undefined);
    setUser(null);
    setMfaRequired(false);
  }

  if (user && mfaRequired) {
    return (
      <MfaGate
        onVerified={() => {
          setMfaRequired(false);
          void api.me().then((r) => setUser(r.user));
        }}
        onLogout={() => void logout()}
      />
    );
  }

  const publicAuth = user ? logout : undefined;

  return (
    <Routes>
      <Route path="/docs/*" element={<DocsPage user={user} onLogout={publicAuth} />} />
      <Route path="/product" element={<ProductPage user={user} onLogout={publicAuth} />} />
      {!user ? (
        <Route path="*" element={<LoginPage />} />
      ) : (
        <>
          <Route
            path="/"
            element={<Home user={user} onLogout={logout} onUserUpdate={setUser} />}
          />
          <Route
            path="/workspaces/:id"
            element={
              <WorkspaceRoute user={user} onLogout={logout} onUserUpdate={setUser} />
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      )}
    </Routes>
  );
}

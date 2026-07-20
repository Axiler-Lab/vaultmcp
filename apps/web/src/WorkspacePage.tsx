import { useEffect, useId, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CheckIcon,
  ClipboardDocumentIcon,
  CloudIcon,
  CodeBracketIcon,
  CommandLineIcon,
  CubeIcon,
  EllipsisHorizontalCircleIcon,
  KeyIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline";
import { MCP_CLIENT_SERVER_KEY } from "@vaultmcp/shared";
import { api, type User } from "./api";
import { Dock } from "./Dock";
import {
  INTEGRATION_TEMPLATES,
  integrationStatus,
  statusLabel,
  type IntegrationStatus,
  type IntegrationTemplate,
} from "./integrationTemplates";
import { AppShell, Aurora } from "./Layout";
import { McpTokensPanel } from "./McpTokensPanel";
import { AuditActivityChart, WorkspaceStatsStrip } from "./WorkspaceStats";

type PrimaryTab = "integrations" | "connect" | "team" | "advanced";
type AdvancedSub = "secrets" | "upstreams" | "audit";
type ConnectPath = "oauth" | "token";
type TokenSubPath = "mcp" | "env";

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <span className="field-label">
      {children}
      {required ? <span className="req" aria-hidden> *</span> : null}
    </span>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: typeof KeyIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden>
        <Icon />
      </div>
      <p className="empty-state-title">{title}</p>
      <p className="empty-state-body">{body}</p>
      {action}
    </div>
  );
}

function templateIcon(id: string) {
  switch (id) {
    case "github":
      return CodeBracketIcon;
    case "aws":
      return CloudIcon;
    case "custom":
      return WrenchScrewdriverIcon;
    default:
      return CubeIcon;
  }
}

function statusClass(status: IntegrationStatus): string {
  switch (status) {
    case "ready":
      return "badge-shared";
    case "needs_secrets":
      return "badge-needs";
    default:
      return "badge-private";
  }
}

export function WorkspacePage({
  user,
  workspaceId,
  onLogout,
  onUserUpdate,
}: {
  user: User;
  workspaceId: string;
  onLogout: () => void;
  onUserUpdate: (user: User) => void;
}) {
  const navigate = useNavigate();
  const tabsId = useId();
  const [tab, setTab] = useState<PrimaryTab>("integrations");
  const [advancedSub, setAdvancedSub] = useState<AdvancedSub>("secrets");
  const [workspace, setWorkspace] = useState<{ name: string; slug: string } | null>(null);
  const [role, setRole] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [defaultBusy, setDefaultBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [installBusy, setInstallBusy] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("https://vaultmcp.dev/mcp");
  const [mcpConfig, setMcpConfig] = useState("");
  const [copied, setCopied] = useState(false);
  const [connectPath, setConnectPath] = useState<ConnectPath | null>(null);
  const [tokenSubPath, setTokenSubPath] = useState<TokenSubPath>("mcp");
  const [tokenCount, setTokenCount] = useState(0);

  const [secrets, setSecrets] = useState<
    Array<{ id: string; name: string; visibility: string; tags: string[] }>
  >([]);
  const [upstreams, setUpstreams] = useState<
    Array<{
      id: string;
      name: string;
      slug: string;
      transport: string;
      requiredSecrets: string[];
      enabled: boolean;
    }>
  >([]);
  const [members, setMembers] = useState<
    Array<{ id: string; role: string; githubLogin: string; name: string | null }>
  >([]);
  const [logs, setLogs] = useState<
    Array<{
      id: string;
      action: string;
      upstreamSlug: string | null;
      toolName: string | null;
      allowed: boolean;
      createdAt: string;
    }>
  >([]);

  const [installTemplateId, setInstallTemplateId] = useState<string | null>(null);
  const [installValues, setInstallValues] = useState<Record<string, string>>({});
  const [installVisibility, setInstallVisibility] = useState<Record<string, string>>({});

  const [secretForm, setSecretForm] = useState({
    name: "",
    value: "",
    visibility: "private",
  });
  const [inviteForm, setInviteForm] = useState({ githubLogin: "", role: "member" });
  const [upstreamForm, setUpstreamForm] = useState({
    name: "",
    slug: "",
    transport: "stdio",
    command: "",
    args: "",
    url: "",
    envJson: '{\n  "EXAMPLE_KEY": "{{secret:EXAMPLE_KEY}}"\n}',
  });

  const isDefault = user.defaultWorkspaceId === workspaceId;

  const installTemplate = useMemo(
    () => INTEGRATION_TEMPLATES.find((t) => t.id === installTemplateId) ?? null,
    [installTemplateId],
  );

  const integrationsReady = useMemo(
    () =>
      INTEGRATION_TEMPLATES.filter(
        (t) => !t.custom && integrationStatus(t, secrets, upstreams) === "ready",
      ).length,
    [secrets, upstreams],
  );
  const integrationsCatalog = INTEGRATION_TEMPLATES.filter((t) => !t.custom).length;
  const auditAllowed = logs.filter((l) => l.allowed).length;
  const auditDenied = logs.filter((l) => !l.allowed).length;

  async function refresh() {
    const ws = await api.getWorkspace(workspaceId);
    setWorkspace(ws.workspace);
    setRole(ws.role);
    const [s, u, m, cfg, tok] = await Promise.all([
      api.listSecrets(workspaceId),
      api.listUpstreams(workspaceId),
      api.listMembers(workspaceId),
      api.config().catch(() => null),
      api.listTokens().catch(() => ({ tokens: [] as Array<{ id: string }> })),
    ]);
    setSecrets(s.secrets);
    setUpstreams(u.upstreams);
    setMembers(m.members);
    setTokenCount(tok.tokens.length);
    if (cfg) {
      setMcpUrl(cfg.mcpUrl);
      setMcpConfig(JSON.stringify(cfg.cursorConfig, null, 2));
    }
    if (ws.role === "admin" || ws.role === "owner") {
      const a = await api.listAudit(workspaceId);
      setLogs(a.logs);
    }
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [workspaceId]);

  function openInstall(template: IntegrationTemplate) {
    if (template.custom) {
      setTab("advanced");
      setAdvancedSub("upstreams");
      setInstallTemplateId(null);
      setNotice("Use Advanced → Upstreams to register a custom MCP.");
      return;
    }
    const values: Record<string, string> = {};
    const visibility: Record<string, string> = {};
    for (const slot of template.secrets) {
      values[slot.name] = "";
      visibility[slot.name] = slot.visibility;
    }
    setInstallValues(values);
    setInstallVisibility(visibility);
    setInstallTemplateId(template.id);
    setError(null);
    setNotice(null);
  }

  function closeInstall() {
    setInstallTemplateId(null);
    setInstallValues({});
    setInstallVisibility({});
  }

  async function makeDefault() {
    setError(null);
    setNotice(null);
    setDefaultBusy(true);
    try {
      const res = await api.setDefault(workspaceId);
      onUserUpdate(res.user);
      setNotice("This workspace is now your default for new MCP sessions.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDefaultBusy(false);
    }
  }

  async function deleteWorkspace() {
    if (
      !window.confirm(
        `Delete workspace "${workspace?.name ?? "this workspace"}"? This permanently removes its secrets, upstreams, and memberships.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    setDeleteBusy(true);
    try {
      const res = await api.deleteWorkspace(workspaceId);
      onUserUpdate(res.user);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleteBusy(false);
    }
  }

  async function copyMcpConfig() {
    const text =
      mcpConfig ||
      JSON.stringify({ mcpServers: { [MCP_CLIENT_SERVER_KEY]: { url: mcpUrl } } }, null, 2);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function installIntegration(e: React.FormEvent) {
    e.preventDefault();
    if (!installTemplate?.upstream) return;
    setError(null);
    setNotice(null);
    setInstallBusy(true);
    try {
      const hasUpstream = upstreams.some((u) => u.slug === installTemplate.upstream!.slug);
      if (!hasUpstream && !(role === "owner" || role === "admin")) {
        throw new Error("Only workspace admins can register the upstream for this integration.");
      }

      const existingNames = new Set(secrets.map((s) => s.name));
      for (const slot of installTemplate.secrets) {
        if (existingNames.has(slot.name)) continue;
        const value = (installValues[slot.name] ?? "").trim();
        if (!value) {
          throw new Error(`Enter a value for ${slot.name}.`);
        }
        await api.createSecret(workspaceId, {
          name: slot.name,
          value,
          visibility: installVisibility[slot.name] ?? slot.visibility,
        });
      }

      if (!hasUpstream) {
        await api.createUpstream(workspaceId, installTemplate.upstream);
      }

      const slug = installTemplate.upstream.slug;
      await refresh();
      closeInstall();
      setNotice(
        `${installTemplate.name} is ready. After MCP reload, tools appear as ${slug}__*.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallBusy(false);
    }
  }

  async function addSecret(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createSecret(workspaceId, {
        name: secretForm.name,
        value: secretForm.value,
        visibility: secretForm.visibility,
      });
      setSecretForm({ name: "", value: "", visibility: "private" });
      setNotice("Secret stored encrypted.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function addUpstream(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      let envTemplate: Record<string, string> = {};
      if (upstreamForm.envJson.trim()) {
        envTemplate = JSON.parse(upstreamForm.envJson) as Record<string, string>;
      }
      await api.createUpstream(workspaceId, {
        name: upstreamForm.name,
        slug: upstreamForm.slug,
        transport: upstreamForm.transport,
        command: upstreamForm.transport === "stdio" ? upstreamForm.command : undefined,
        args:
          upstreamForm.transport === "stdio"
            ? upstreamForm.args
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        url: upstreamForm.transport === "http" ? upstreamForm.url : undefined,
        envTemplate,
      });
      setUpstreamForm({
        name: "",
        slug: "",
        transport: "stdio",
        command: "",
        args: "",
        url: "",
        envJson: '{\n  "EXAMPLE_KEY": "{{secret:EXAMPLE_KEY}}"\n}',
      });
      setNotice("Upstream registered.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const githubLogin = inviteForm.githubLogin.trim().replace(/^@+/, "");
    if (!githubLogin) {
      setError("Enter a GitHub username.");
      return;
    }
    try {
      await api.inviteMember(workspaceId, { ...inviteForm, githubLogin });
      setInviteForm({ githubLogin: "", role: "member" });
      setNotice(`Invited @${githubLogin.toLowerCase()}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (!workspace) {
    return (
      <div className="app-root">
        <Aurora />
        <div className="loading-screen">
          Loading workspace…
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const canWrite = role === "owner" || role === "admin" || role === "member";
  const canAdmin = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const tabItems: Array<[PrimaryTab, string, typeof KeyIcon]> = [
    ["integrations", "Integrations", CubeIcon],
    ["connect", "Connect", CommandLineIcon],
    ["team", "Team", UserGroupIcon],
    ["advanced", "Advanced", EllipsisHorizontalCircleIcon],
  ];

  const advancedItems: Array<[AdvancedSub, string, typeof KeyIcon]> = [
    ["secrets", "Secrets", KeyIcon],
    ["upstreams", "Upstreams", CloudIcon],
    ...(canAdmin
      ? ([["audit", "Audit", ShieldCheckIcon]] as Array<[AdvancedSub, string, typeof KeyIcon]>)
      : []),
  ];

  return (
    <AppShell user={user} onLogout={onLogout}>
      <main className="shell workspace-shell">
        <header className="page-header workspace-header">
          <div className="workspace-header-main">
            <p className="section-label">Workspace</p>
            <h1>
              {workspace.name}
              {isDefault && <span className="badge badge-default">Default</span>}
            </h1>
            <div className="workspace-meta">
              <span className="mono workspace-slug">{workspace.slug}</span>
              <span className="workspace-meta-sep" aria-hidden>
                ·
              </span>
              <span className="badge badge-role">{role}</span>
            </div>
            <p className="workspace-lede">
              Add integrations from templates, then connect your IDE. Secrets stay encrypted here.
            </p>
          </div>
          <div className="workspace-header-actions">
            <div className="workspace-actions-primary">
              {isDefault ? (
                <span className="default-status" aria-live="polite">
                  <CheckIcon className="btn-icon" aria-hidden />
                  Default for MCP
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={defaultBusy || deleteBusy}
                  onClick={() => void makeDefault()}
                >
                  {defaultBusy ? "Saving…" : "Set as default"}
                </button>
              )}
              <Link className="btn btn-ghost" to="/">
                All workspaces
              </Link>
            </div>
            {isOwner && (
              <div className="workspace-actions-danger">
                <button
                  type="button"
                  className="btn btn-danger btn-danger-quiet"
                  disabled={deleteBusy}
                  onClick={() => void deleteWorkspace()}
                >
                  <TrashIcon className="btn-icon" aria-hidden />
                  {deleteBusy ? "Deleting…" : "Delete workspace"}
                </button>
              </div>
            )}
          </div>
        </header>

        <WorkspaceStatsStrip
          secrets={secrets.length}
          integrationsReady={integrationsReady}
          integrationsTotal={integrationsCatalog}
          members={members.length}
          tokens={tokenCount}
          auditAllowed={canAdmin ? auditAllowed : undefined}
          auditDenied={canAdmin ? auditDenied : undefined}
        />

        <div className="tabs workspace-tabs" role="tablist" aria-label="Workspace sections">
          {tabItems.map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${tabsId}-${id}`}
              aria-selected={tab === id}
              aria-controls={`${tabsId}-panel-${id}`}
              className={`tab ${tab === id ? "active" : ""}`}
              onClick={() => {
                setTab(id);
                if (id !== "integrations") closeInstall();
              }}
            >
              <Icon className="tab-icon" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {error && (
          <p className="error banner-alert" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice" role="status" aria-live="polite">
            {notice}
          </p>
        )}

        <div
          role="tabpanel"
          id={`${tabsId}-panel-${tab}`}
          aria-labelledby={`${tabsId}-${tab}`}
          className="workspace-tab-panel"
        >
          {tab === "integrations" && (
            <div className="integrations-layout">
              <section className="integrations-intro">
                <p className="section-label">Catalog</p>
                <h2>Integrations</h2>
                <p className="muted">
                  Pick a provider. VaultMCP creates the secret slots and upstream wiring — you only
                  paste values.
                </p>
              </section>

              <div className="integrations-grid">
                {INTEGRATION_TEMPLATES.map((template) => {
                  const status = integrationStatus(template, secrets, upstreams);
                  const Icon = templateIcon(template.id);
                  const selected = installTemplateId === template.id;
                  return (
                    <article
                      key={template.id}
                      className={`integration-card ${selected ? "is-selected" : ""} ${status === "ready" ? "is-ready" : ""}`}
                    >
                      <div className="integration-card-top">
                        <div className="integration-card-icon" aria-hidden>
                          <Icon />
                        </div>
                        <span className={`badge ${statusClass(status)}`}>
                          {template.custom ? "Advanced" : statusLabel(status)}
                        </span>
                      </div>
                      <h3>{template.name}</h3>
                      <p>{template.description}</p>
                      <div className="integration-card-actions">
                        {template.custom ? (
                          canAdmin ? (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => openInstall(template)}
                            >
                              Open advanced
                            </button>
                          ) : (
                            <button type="button" className="btn btn-ghost" disabled>
                              Admin only
                            </button>
                          )
                        ) : status === "ready" ? (
                          <button type="button" className="btn btn-ghost" disabled>
                            Installed
                          </button>
                        ) : (() => {
                          const needsUpstream =
                            !!template.upstream &&
                            !upstreams.some((u) => u.slug === template.upstream!.slug);
                          const canStart = needsUpstream ? canAdmin : canWrite;
                          if (!canStart) {
                            return (
                              <button type="button" className="btn btn-ghost" disabled>
                                {needsUpstream ? "Ask an admin" : "View only"}
                              </button>
                            );
                          }
                          return (
                            <button
                              type="button"
                              className="btn btn-primary"
                              onClick={() => openInstall(template)}
                            >
                              {status === "needs_secrets" ? "Finish setup" : "Add"}
                            </button>
                          );
                        })()}
                      </div>
                    </article>
                  );
                })}
              </div>

              {installTemplate && installTemplate.upstream && (
                <section className="panel integration-install-panel" aria-labelledby="install-heading">
                  <div className="panel-head">
                    <div>
                      <p className="section-label">Setup</p>
                      <h2 id="install-heading">Add {installTemplate.name}</h2>
                      <p className="muted">
                        Fixed secret names from the template. After save, tools show as{" "}
                        <span className="mono">{installTemplate.upstream.slug}__*</span> once you
                        reload MCP.
                      </p>
                    </div>
                    <button type="button" className="btn btn-ghost" onClick={closeInstall}>
                      Cancel
                    </button>
                  </div>

                  <form className="stack" onSubmit={(e) => void installIntegration(e)}>
                    {installTemplate.secrets.map((slot) => {
                      const alreadyStored = secrets.some((s) => s.name === slot.name);
                      return (
                        <div key={slot.name} className="integration-secret-slot">
                          {alreadyStored ? (
                            <div className="integration-secret-stored">
                              <span className="field-label">
                                <span className="mono">{slot.name}</span>
                              </span>
                              <p className="muted">
                                Already stored — skipped. Delete it under Advanced → Secrets to
                                replace.
                              </p>
                            </div>
                          ) : (
                            <div className="fields-row fields-row-asymmetric">
                              <label className="field">
                                <FieldLabel required>
                                  <span className="mono">{slot.name}</span>
                                </FieldLabel>
                                <input
                                  type={
                                    slot.name.toLowerCase().includes("secret") ||
                                    slot.name.toLowerCase().includes("token") ||
                                    slot.name.toLowerCase().includes("key")
                                      ? "password"
                                      : "text"
                                  }
                                  className="mono"
                                  value={installValues[slot.name] ?? ""}
                                  onChange={(e) =>
                                    setInstallValues({
                                      ...installValues,
                                      [slot.name]: e.target.value,
                                    })
                                  }
                                  placeholder={slot.hint}
                                  autoComplete="off"
                                  spellCheck={false}
                                  required
                                />
                              </label>
                              <label className="field">
                                <FieldLabel>Visibility</FieldLabel>
                                <select
                                  value={installVisibility[slot.name] ?? slot.visibility}
                                  onChange={(e) =>
                                    setInstallVisibility({
                                      ...installVisibility,
                                      [slot.name]: e.target.value,
                                    })
                                  }
                                >
                                  <option value="private">Private (only me)</option>
                                  <option value="workspace">Shared (workspace members)</option>
                                </select>
                              </label>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <div className="integration-upstream-preview">
                      <p className="muted">
                        Upstream: <span className="mono">{installTemplate.upstream.slug}</span>
                        {upstreams.some((u) => u.slug === installTemplate.upstream!.slug)
                          ? " — already registered"
                          : ` — will register ${installTemplate.upstream.command ?? ""} ${(installTemplate.upstream.args ?? []).join(" ")}`.trim()}
                      </p>
                    </div>

                    <div className="row">
                      <button
                        className="btn btn-primary"
                        type="submit"
                        disabled={installBusy || (!canWrite && !canAdmin)}
                      >
                        {installBusy ? "Saving…" : "Save integration"}
                      </button>
                    </div>
                  </form>
                </section>
              )}

              <p className="integrations-advanced-hint muted">
                Need the raw secret list or custom upstream JSON?{" "}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => {
                    setTab("advanced");
                    setAdvancedSub("secrets");
                  }}
                >
                  Open Advanced
                </button>
              </p>
            </div>
          )}

          {tab === "connect" && (
            <div className="connect-layout connect-layout-v2">
              <section className="panel connect-hero-panel">
                <div className="connect-hero-top">
                  <div>
                    <p className="section-label">Connect</p>
                    <h2>Point your IDE at VaultMCP</h2>
                    <p className="muted connect-lede">
                      Never put provider secrets in IDE config. Choose how you authenticate.
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
                      PAT in headers for MCP, or Runtime env for the CLI.
                    </span>
                  </button>
                </div>

                {!isDefault && (
                  <div className="connect-default-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={defaultBusy}
                      onClick={() => void makeDefault()}
                    >
                      {defaultBusy ? "Saving…" : "Set this workspace as default"}
                    </button>
                    <p className="muted connect-default-hint">
                      New MCP sessions pick the default workspace automatically.
                    </p>
                  </div>
                )}
              </section>

              {connectPath === "oauth" && (
                <section className="panel connect-method-panel connect-reveal" aria-labelledby="oauth-heading">
                  <div className="panel-head">
                    <div>
                      <p className="section-label">OAuth</p>
                      <h2 id="oauth-heading">Client config</h2>
                      <p className="muted">
                        Paste into <span className="mono">~/.cursor/mcp.json</span>, then reload MCP
                        and complete the browser Connect step.
                      </p>
                    </div>
                  </div>
                  <div className="code-block">
                    <button
                      type="button"
                      className="btn copy-btn"
                      onClick={() => void copyMcpConfig()}
                    >
                      <ClipboardDocumentIcon className="btn-icon" aria-hidden />
                      {copied ? "Copied" : "Copy"}
                    </button>
                    {mcpConfig ||
                      JSON.stringify(
                        { mcpServers: { [MCP_CLIENT_SERVER_KEY]: { url: mcpUrl } } },
                        null,
                        2,
                      )}
                  </div>
                  <ol className="steps connect-steps-compact">
                    <li>
                      Reload MCP. Complete browser OAuth with the same GitHub account.
                    </li>
                    <li>
                      Run <span className="mono">list_workspaces</span>, then{" "}
                      <span className="mono">use_workspace</span> with{" "}
                      <span className="mono">{workspace.slug}</span>
                      {isDefault ? " (already your default)." : "."}
                    </li>
                  </ol>
                  <p className="connect-meta">
                    MCP URL: <span className="mono">{mcpUrl}</span>
                  </p>
                </section>
              )}

              {connectPath === "token" && (
                <div className="connect-token-flow connect-reveal">
                  <div
                    className="connect-token-subs"
                    role="tablist"
                    aria-label="Token type"
                  >
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
                          Env-scoped PAT exports plaintext to the laptop. Prefer{" "}
                          <span className="mono">run</span> over printing dotenv files.
                        </p>
                      </div>
                      <div className="code-block">
                        {`npx @vaultmcp-axiler/cli@latest run -w ${workspace.slug} -- npm run dev`}
                      </div>
                      <Link className="connect-env-link" to="/docs#local-env">
                        Docs → Local env / CLI
                      </Link>
                    </aside>
                  )}

                  <McpTokensPanel
                    mcpUrl={mcpUrl}
                    mode={tokenSubPath === "env" ? "env" : "mcp"}
                    onTokensChange={setTokenCount}
                    onNotice={(msg) => {
                      setNotice(msg);
                      setError(null);
                    }}
                    onError={(msg) => {
                      setError(msg);
                      setNotice(null);
                    }}
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

          {tab === "team" && (
            <div className="grid grid-2">
              <section className="panel">
                <div className="panel-head">
                  <div>
                    <p className="section-label">Members</p>
                    <h2>Team</h2>
                    <p className="muted">People who can use this workspace through VaultMCP.</p>
                  </div>
                  <span className="panel-count" aria-label={`${members.length} members`}>
                    {members.length}
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Role</th>
                        <th>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.id}>
                          <td>@{m.githubLogin}</td>
                          <td>
                            <span className="badge badge-role">{m.role}</span>
                          </td>
                          <td className="td-actions">
                            {canAdmin && m.role !== "owner" && (
                              <button
                                type="button"
                                className="btn btn-table-action"
                                aria-label={`Remove @${m.githubLogin}`}
                                onClick={() =>
                                  api
                                    .removeMember(workspaceId, m.id)
                                    .then(() => {
                                      setNotice("Member removed.");
                                      return refresh();
                                    })
                                    .catch((e) => setError(String(e)))
                                }
                              >
                                Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              {canAdmin && (
                <section className="panel">
                  <p className="section-label">Invite</p>
                  <h2>Add a member</h2>
                  <p className="muted">
                    They must open vaultmcp.dev and Sign in with GitHub once before you can add them.
                  </p>
                  <form className="stack" onSubmit={invite}>
                    <div className="fields-row fields-row-asymmetric">
                      <label className="field">
                        <FieldLabel required>GitHub username</FieldLabel>
                        <input
                          value={inviteForm.githubLogin}
                          onChange={(e) =>
                            setInviteForm({ ...inviteForm, githubLogin: e.target.value })
                          }
                          placeholder="octocat"
                          autoComplete="username"
                          spellCheck={false}
                          required
                        />
                      </label>
                      <label className="field">
                        <FieldLabel>Role</FieldLabel>
                        <select
                          value={inviteForm.role}
                          onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                          <option value="viewer">viewer</option>
                        </select>
                      </label>
                    </div>
                    {error && tab === "team" && (
                      <p className="form-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="btn btn-primary" type="submit">
                      Invite
                    </button>
                  </form>
                </section>
              )}
            </div>
          )}

          {tab === "advanced" && (
            <div className="advanced-layout">
              <div
                className="tabs advanced-subtabs"
                role="tablist"
                aria-label="Advanced sections"
              >
                {advancedItems.map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    className={`tab ${advancedSub === id ? "active" : ""}`}
                    aria-selected={advancedSub === id}
                    onClick={() => setAdvancedSub(id)}
                  >
                    <Icon className="tab-icon" aria-hidden />
                    {label}
                  </button>
                ))}
              </div>

              {advancedSub === "secrets" && (
                <div className="grid grid-2">
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <p className="section-label">Vault</p>
                        <h2>All secrets</h2>
                        <p className="muted">
                          Values are write-only. Prefer Integrations templates when possible.
                        </p>
                      </div>
                      {secrets.length > 0 && (
                        <span className="panel-count" aria-label={`${secrets.length} secrets`}>
                          {secrets.length}
                        </span>
                      )}
                    </div>
                    {secrets.length === 0 ? (
                      <EmptyState
                        icon={KeyIcon}
                        title="No secrets yet"
                        body="Add an integration template, or store a free-form secret here."
                        action={
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setTab("integrations")}
                          >
                            Browse integrations
                          </button>
                        }
                      />
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Visibility</th>
                              <th>
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {secrets.map((s) => (
                              <tr key={s.id}>
                                <td className="mono">{s.name}</td>
                                <td>
                                  <span
                                    className={`badge ${s.visibility === "workspace" ? "badge-shared" : "badge-private"}`}
                                  >
                                    {s.visibility === "workspace" ? "shared" : "private"}
                                  </span>
                                </td>
                                <td className="td-actions">
                                  {canWrite && (
                                    <button
                                      type="button"
                                      className="btn btn-table-action"
                                      aria-label={`Delete secret ${s.name}`}
                                      onClick={() =>
                                        api
                                          .deleteSecret(workspaceId, s.id)
                                          .then(() => {
                                            setNotice("Secret deleted.");
                                            return refresh();
                                          })
                                          .catch((e) => setError(String(e)))
                                      }
                                    >
                                      Delete
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {canWrite && (
                    <section className="panel">
                      <p className="section-label">New</p>
                      <h2>Add secret</h2>
                      <p className="muted">Encrypted at rest. The value is never shown again.</p>
                      <form className="stack" onSubmit={addSecret}>
                        <label>
                          <FieldLabel required>Name</FieldLabel>
                          <input
                            id="add-secret-name"
                            className="mono"
                            value={secretForm.name}
                            onChange={(e) =>
                              setSecretForm({ ...secretForm, name: e.target.value })
                            }
                            placeholder="MY_API_KEY"
                            autoComplete="off"
                            required
                          />
                        </label>
                        <label>
                          <FieldLabel required>Value</FieldLabel>
                          <textarea
                            value={secretForm.value}
                            onChange={(e) =>
                              setSecretForm({ ...secretForm, value: e.target.value })
                            }
                            autoComplete="off"
                            spellCheck={false}
                            required
                          />
                        </label>
                        <label>
                          <FieldLabel>Visibility</FieldLabel>
                          <select
                            value={secretForm.visibility}
                            onChange={(e) =>
                              setSecretForm({ ...secretForm, visibility: e.target.value })
                            }
                          >
                            <option value="private">Private (only me)</option>
                            <option value="workspace">Shared (workspace members)</option>
                          </select>
                        </label>
                        <button className="btn btn-primary" type="submit">
                          Store encrypted
                        </button>
                      </form>
                    </section>
                  )}
                </div>
              )}

              {advancedSub === "upstreams" && (
                <div className="grid grid-2">
                  <section className="panel">
                    <div className="panel-head">
                      <div>
                        <p className="section-label">Proxied MCPs</p>
                        <h2>Upstream MCPs</h2>
                        <p className="muted">
                          Tools appear in the IDE as <span className="mono">slug__tool_name</span>.
                        </p>
                      </div>
                      {upstreams.length > 0 && (
                        <span
                          className="panel-count"
                          aria-label={`${upstreams.length} upstreams`}
                        >
                          {upstreams.length}
                        </span>
                      )}
                    </div>
                    {upstreams.length === 0 ? (
                      <EmptyState
                        icon={CloudIcon}
                        title="No upstreams"
                        body="Use an Integrations template, or register a custom MCP here."
                        action={
                          <button
                            type="button"
                            className="btn"
                            onClick={() => setTab("integrations")}
                          >
                            Browse integrations
                          </button>
                        }
                      />
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Slug</th>
                              <th>Secrets</th>
                              <th>
                                <span className="sr-only">Actions</span>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {upstreams.map((u) => (
                              <tr key={u.id}>
                                <td>{u.name}</td>
                                <td className="mono">{u.slug}</td>
                                <td className="mono">{u.requiredSecrets.join(", ") || "—"}</td>
                                <td className="td-actions">
                                  {canAdmin && (
                                    <button
                                      type="button"
                                      className="btn btn-table-action"
                                      aria-label={`Delete upstream ${u.name}`}
                                      onClick={() =>
                                        api
                                          .deleteUpstream(workspaceId, u.id)
                                          .then(() => {
                                            setNotice("Upstream deleted.");
                                            return refresh();
                                          })
                                          .catch((e) => setError(String(e)))
                                      }
                                    >
                                      Delete
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {canAdmin && (
                    <section className="panel">
                      <p className="section-label">New</p>
                      <h2>Register upstream</h2>
                      <p className="muted">Map env vars to secrets with {"{{secret:NAME}}"}.</p>
                      <form className="stack" onSubmit={addUpstream}>
                        <div className="fields-row">
                          <label className="field">
                            <FieldLabel required>Name</FieldLabel>
                            <input
                              id="upstream-name"
                              value={upstreamForm.name}
                              onChange={(e) =>
                                setUpstreamForm({ ...upstreamForm, name: e.target.value })
                              }
                              required
                            />
                          </label>
                          <label className="field">
                            <FieldLabel required>Slug</FieldLabel>
                            <input
                              value={upstreamForm.slug}
                              onChange={(e) =>
                                setUpstreamForm({
                                  ...upstreamForm,
                                  slug: e.target.value.toLowerCase(),
                                })
                              }
                              pattern="[a-z0-9-]+"
                              required
                            />
                          </label>
                        </div>
                        <label>
                          <FieldLabel>Transport</FieldLabel>
                          <select
                            value={upstreamForm.transport}
                            onChange={(e) =>
                              setUpstreamForm({ ...upstreamForm, transport: e.target.value })
                            }
                          >
                            <option value="stdio">stdio</option>
                            <option value="http">http</option>
                          </select>
                        </label>
                        {upstreamForm.transport === "stdio" ? (
                          <>
                            <label>
                              <FieldLabel required>Command</FieldLabel>
                              <input
                                className="mono"
                                value={upstreamForm.command}
                                onChange={(e) =>
                                  setUpstreamForm({ ...upstreamForm, command: e.target.value })
                                }
                                placeholder="uvx"
                                required
                              />
                            </label>
                            <label>
                              <FieldLabel>Args (comma-separated)</FieldLabel>
                              <input
                                className="mono"
                                value={upstreamForm.args}
                                onChange={(e) =>
                                  setUpstreamForm({ ...upstreamForm, args: e.target.value })
                                }
                                placeholder="awslabs.aws-api-mcp-server@latest"
                              />
                            </label>
                          </>
                        ) : (
                          <label>
                            <FieldLabel required>URL</FieldLabel>
                            <input
                              type="url"
                              value={upstreamForm.url}
                              onChange={(e) =>
                                setUpstreamForm({ ...upstreamForm, url: e.target.value })
                              }
                              placeholder="https://..."
                              required
                            />
                          </label>
                        )}
                        <label>
                          <FieldLabel>Env template (JSON)</FieldLabel>
                          <textarea
                            value={upstreamForm.envJson}
                            onChange={(e) =>
                              setUpstreamForm({ ...upstreamForm, envJson: e.target.value })
                            }
                            spellCheck={false}
                          />
                        </label>
                        <button className="btn btn-primary" type="submit">
                          Register
                        </button>
                      </form>
                    </section>
                  )}
                </div>
              )}

              {advancedSub === "audit" && canAdmin && (
                <section className="panel">
                  <div className="panel-head">
                    <div>
                      <p className="section-label">Log</p>
                      <h2>Activity</h2>
                      <p className="muted">Tool invocations. Secret values are never logged.</p>
                    </div>
                    {logs.length > 0 && (
                      <span className="panel-count" aria-label={`${logs.length} events`}>
                        {logs.length}
                      </span>
                    )}
                  </div>
                  <div className="ws-audit-chart-wrap">
                    <p className="ws-donut-label">Last 7 days</p>
                    <AuditActivityChart logs={logs} />
                  </div>
                  {logs.length === 0 ? (
                    <EmptyState
                      icon={ShieldCheckIcon}
                      title="No events yet"
                      body="Invocations from connected IDEs will appear here."
                    />
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>When</th>
                            <th>Action</th>
                            <th>Tool</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((l) => (
                            <tr key={l.id}>
                              <td className="mono">{new Date(l.createdAt).toLocaleString()}</td>
                              <td>{l.action}</td>
                              <td className="mono">
                                {l.upstreamSlug ? `${l.upstreamSlug}__${l.toolName}` : "—"}
                              </td>
                              <td>
                                <span
                                  className={`badge ${l.allowed ? "badge-shared" : "badge-denied"}`}
                                >
                                  {l.allowed ? "allowed" : "denied"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </main>
      <Dock user={user} />
    </AppShell>
  );
}

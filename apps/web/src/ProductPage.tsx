import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowPathIcon,
  ArrowRightIcon,
  CloudIcon,
  CommandLineIcon,
  CubeTransparentIcon,
  KeyIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { loginUrl, type User } from "./api";
import { Dock } from "./Dock";
import { AppShell } from "./Layout";

/** Illustrative secret name only — no real credentials. */
const EXAMPLE_TOKEN = "GITHUB_TOKEN";

const LIFECYCLE = [
  {
    id: "store",
    title: "Store",
    subtitle: "Encrypt at rest",
    body: "You paste a provider token once into the workspace (or via an Integration template). VaultMCP seals it with AES-256-GCM under a per-workspace key (envelope encryption). Later list calls show the name and visibility only — never the value.",
    detail: "Private secrets resolve for you; shared secrets resolve for member+ in that workspace.",
    icon: KeyIcon,
    formLabel: "At rest",
    formValue: "Workspace DEK · AES-256-GCM",
    formHint: "Write-only. Name stays readable for wiring.",
    boundary: "Control plane → Postgres vault",
  },
  {
    id: "map",
    title: "Wire",
    subtitle: "Integration template",
    body: "Pick GitHub, AWS, or a custom upstream. VaultMCP registers the MCP server with env placeholders like {{secret:GITHUB_TOKEN}} — the gateway holds the wiring, not the IDE.",
    detail: "Templates fix the secret names and upstream command. You only paste values into the slots.",
    icon: CubeTransparentIcon,
    formLabel: "In the template",
    formValue: "{{secret:GITHUB_TOKEN}}",
    formHint: "Placeholder in env/headers — no plaintext in config JSON.",
    boundary: "Integrations → upstream MCP",
  },
  {
    id: "connect",
    title: "Connect",
    subtitle: "OAuth or personal token",
    body: "Point Cursor (or any MCP client) at one URL. Authenticate with browser OAuth or a dashboard vmcp_… PAT. Provider keys never land in mcp.json.",
    detail: "PATs can be read-only or read+write, with optional expiry. OAuth follows workspace roles.",
    icon: CommandLineIcon,
    formLabel: "In the IDE",
    formValue: "https://…/mcp",
    formHint: "URL (+ optional VaultMCP PAT). No GitHub/AWS keys.",
    boundary: "IDE ↔ VaultMCP gateway",
  },
  {
    id: "inject",
    title: "Inject",
    subtitle: "Server-side boundary",
    body: "The agent selects a workspace, then calls a namespaced tool (for example github__…). VaultMCP checks access, decrypts in-process, fills placeholders, and starts the upstream for that call only.",
    detail: "Viewers cannot trigger injection. Decrypt never crosses back to the IDE session.",
    icon: LockClosedIcon,
    formLabel: "In process",
    formValue: "ephemeral → upstream env",
    formHint: "Plaintext lives only inside the API for that request.",
    boundary: "Gateway → upstream MCP",
  },
  {
    id: "act",
    title: "Act",
    subtitle: "Results without keys",
    body: "The agent gets tool output — repo lists, AWS responses, and so on. Secret values stay out of tool results and audit payloads. Rotate the vault entry; the same MCP URL keeps working.",
    detail: "Audit records allow/deny and metadata. Plaintext is not logged.",
    icon: ShieldCheckIcon,
    formLabel: "In the result",
    formValue: "tool output · secret ∅",
    formHint: "High-level answers. Credentials never echoed.",
    boundary: "Upstream → agent (filtered)",
  },
];

/** High-level product walkthrough (example narrative, not live data). */
const PRODUCT_FLOW = [
  {
    n: "01",
    title: "Add an integration",
    body: "In a workspace, open Integrations and choose a provider. Paste into the template slots — VaultMCP stores secrets and wires the upstream.",
    sample: "GitHub · GITHUB_TOKEN → {{secret:…}}",
  },
  {
    n: "02",
    title: "Connect the IDE once",
    body: "Add the remote MCP URL under the key vaultmcp (OAuth in the browser) or a personal access token in headers. Cursor may log it as user-vaultmcp — same gateway. No provider keys in client config.",
    sample: '{ "mcpServers": { "vaultmcp": { "url": "https://…/mcp" } } }',
  },
  {
    n: "03",
    title: "Select the workspace",
    body: "The agent calls use_workspace (or you set a default). That chooses which vault and upstreams are active for the session.",
    sample: "use_workspace · slug: staging",
  },
  {
    n: "04",
    title: "Call namespaced tools",
    body: "Upstream tools appear under the VaultMCP connection as slug__tool (for example github__search_repositories). The gateway injects credentials server-side on each call.",
    sample: "[VaultMCP → GitHub] github__…",
  },
  {
    n: "05",
    title: "Get answers, not keys",
    body: "Results come back as ordinary tool output — for example a list of repositories. The token never leaves the vault path.",
    sample: "repos · metadata only · secret ∅",
  },
];

const PILLARS = [
  {
    title: "Envelope encryption",
    body: "Each workspace has its own AES-256-GCM data key, wrapped by VAULT_MASTER_KEY. Ciphertext stays in Postgres; list and MCP responses never include it.",
    icon: LockClosedIcon,
  },
  {
    title: "Injection boundary",
    body: "Decrypt runs only inside the API when calling an upstream. Membership and private vs shared checks gate every resolve.",
    icon: ShieldCheckIcon,
  },
  {
    title: "One gateway URL",
    body: "Rotate keys in the vault without rewriting IDE config. Switch environments with use_workspace, not pasted env files.",
    icon: CloudIcon,
  },
];

const BEFORE_AFTER = [
  {
    topic: "Where the secret lives",
    without: "In each IDE config, .env, or paste into chat",
    with: "Encrypted in the vault; write-only from the UI",
  },
  {
    topic: "What the IDE stores",
    without: "Provider keys (GitHub PAT, AWS keys, …)",
    with: "Only the VaultMCP URL — or a vmcp_… gateway token",
  },
  {
    topic: "How the agent reaches GitHub/AWS",
    without: "Separate MCP servers and keys per client",
    with: "One gateway; namespaced tools like github__…",
  },
  {
    topic: "Rotating a leaked key",
    without: "Update every machine and config file",
    with: "Replace the value once in the vault",
  },
];

const SECURITY_POINTS = [
  {
    title: "Write-only values",
    body: "After create or rotate, APIs return names and visibility. Never ciphertext or plaintext.",
  },
  {
    title: "OAuth or personal tokens",
    body: "Control plane uses GitHub login (optional authenticator MFA). MCP clients use OAuth 2.1 + PKCE or a scoped, expiring vmcp_… PAT.",
  },
  {
    title: "Private vs shared",
    body: "Private secrets resolve only for the creator. Shared secrets resolve for member+ in that workspace.",
  },
  {
    title: "Integrations, not env paste",
    body: "Templates wire upstreams with {{secret:NAME}}. The same injection path works for stdio and HTTP MCPs.",
  },
];

const STEP_COUNT = LIFECYCLE.length;
const STEP_ANGLE = 360 / STEP_COUNT;
const RING_CIRCUMFERENCE = 490;

export function ProductPage({
  user,
  onLogout,
}: {
  user?: User | null;
  onLogout?: () => void;
}) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setActive((prev) => (prev + 1) % STEP_COUNT);
    }, 3800);
    return () => window.clearInterval(id);
  }, [paused]);

  const current = LIFECYCLE[active]!;
  const CurrentIcon = current.icon;
  const packetAngle = active * STEP_ANGLE - 90;
  const progressOffset = (1 - (active + 1) / STEP_COUNT) * RING_CIRCUMFERENCE;

  return (
    <AppShell user={user} onLogout={onLogout}>
      <main className="shell product-shell">
        <header className="page-header product-hero">
          <p className="section-label">
            <CubeTransparentIcon className="inline-icon" aria-hidden /> Product
          </p>
          <h1>From vault to agent — without keys in the IDE.</h1>
          <p>
            Store a provider token once, wire an integration, connect any MCP client to one
            gateway URL. Agents call namespaced tools; VaultMCP injects credentials server-side and
            returns results — never the secret.
          </p>
          <div className="hero-cta" style={{ marginTop: "1rem" }}>
            {user ? (
              <Link className="btn btn-primary btn-lg" to="/">
                Open workspaces <ArrowRightIcon className="btn-icon" aria-hidden />
              </Link>
            ) : (
              <a className="btn btn-primary btn-lg" href={loginUrl()}>
                Get started <ArrowRightIcon className="btn-icon" aria-hidden />
              </a>
            )}
            <Link className="link-quiet" to="/docs">
              Self-host docs <ArrowRightIcon className="btn-icon" aria-hidden />
            </Link>
          </div>
        </header>

        <section
          className="lifecycle"
          aria-label="Secret lifecycle"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="lifecycle-head">
            <p className="section-label">
              <ArrowPathIcon className="inline-icon" aria-hidden /> Lifecycle
            </p>
            <h2>How a sealed token moves</h2>
            <p className="muted">
              Illustrative path for <span className="mono">{EXAMPLE_TOKEN}</span> — same pattern for
              AWS keys and other providers. Select a stage or let it advance.
            </p>
          </div>

          <div className="lifecycle-stage">
            <div className="lifecycle-orbit-wrap">
              <div className="lifecycle-circle">
                <div className="lifecycle-ring-wrap" aria-hidden>
                  <svg className="lifecycle-svg" viewBox="0 0 200 200">
                    <circle className="lifecycle-ring-bg" cx="100" cy="100" r="78" />
                    <circle
                      className="lifecycle-ring-progress"
                      cx="100"
                      cy="100"
                      r="78"
                      style={{ strokeDashoffset: progressOffset }}
                    />
                    <circle className="lifecycle-ring-dash" cx="100" cy="100" r="78" />
                  </svg>
                </div>

                <div
                  className={`lifecycle-packet token-${current.id}`}
                  style={{ ["--packet-angle" as string]: `${packetAngle}deg` }}
                  aria-hidden
                >
                  <span className="lifecycle-packet-inner">
                    <LockClosedIcon />
                  </span>
                </div>

                <div className="lifecycle-hub" aria-live="polite">
                  <p className="lifecycle-hub-kicker">{current.formLabel}</p>
                  <p className="lifecycle-hub-secret mono">{EXAMPLE_TOKEN}</p>
                  <code className={`lifecycle-hub-form token-${current.id}`}>
                    {current.formValue}
                  </code>
                  <p className="lifecycle-hub-hint">{current.formHint}</p>
                  <div className="lifecycle-hub-meta">
                    <span className="lifecycle-hub-icon">
                      <CurrentIcon aria-hidden />
                    </span>
                    <div>
                      <p className="lifecycle-hub-step">
                        {String(active + 1).padStart(2, "0")} /{" "}
                        {String(STEP_COUNT).padStart(2, "0")}
                      </p>
                      <h3>{current.title}</h3>
                    </div>
                  </div>
                </div>

                <ol className="lifecycle-nodes">
                  {LIFECYCLE.map((step, index) => {
                    const Icon = step.icon;
                    const angle = index * STEP_ANGLE - 90;
                    const isPast = index < active;
                    return (
                      <li
                        key={step.id}
                        className={`lifecycle-node ${active === index ? "active" : ""} ${
                          isPast ? "past" : ""
                        }`}
                        style={{
                          ["--angle" as string]: `${angle}deg`,
                          animationDelay: `${0.05 * index}s`,
                        }}
                      >
                        <button
                          type="button"
                          className="lifecycle-node-btn"
                          aria-pressed={active === index}
                          aria-label={`${step.title}: ${step.subtitle}`}
                          onClick={() => {
                            setActive(index);
                            setPaused(true);
                          }}
                        >
                          <span className="lifecycle-node-icon">
                            <Icon aria-hidden />
                          </span>
                          <span className="lifecycle-node-meta">
                            <span className="lifecycle-node-label">{step.title}</span>
                            <span className="lifecycle-node-num">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>

              <p className={`lifecycle-close ${active === STEP_COUNT - 1 ? "emphasis" : ""}`}>
                <ArrowPathIcon className="inline-icon" aria-hidden />
                <span>
                  <strong>Close the loop.</strong> Rotate the vault value anytime without rewiring
                  clients. Every IDE keeps the same VaultMCP URL and receives the new credential on
                  the next injection.
                </span>
              </p>
            </div>

            <article className="lifecycle-detail panel">
              <div className="lifecycle-detail-top">
                <span className="lifecycle-hub-icon">
                  <CurrentIcon aria-hidden />
                </span>
                <div>
                  <p className="lifecycle-hub-step">
                    Stage {String(active + 1).padStart(2, "0")} · {current.subtitle}
                  </p>
                  <h3>{current.title}</h3>
                </div>
              </div>
              <p className="lifecycle-detail-body">{current.body}</p>
              <p className="lifecycle-detail-note">{current.detail}</p>
              <p className="lifecycle-packet-boundary">
                <LockClosedIcon className="inline-icon" aria-hidden />
                {current.boundary}
              </p>
              <div className="lifecycle-detail-nav">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setActive((active - 1 + STEP_COUNT) % STEP_COUNT);
                    setPaused(true);
                  }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setActive((active + 1) % STEP_COUNT);
                    setPaused(true);
                  }}
                >
                  Next stage
                </button>
              </div>
            </article>
          </div>
        </section>

        <section className="product-flow" aria-label="End-to-end product flow">
          <header className="section-head">
            <p className="section-label">
              <CommandLineIcon className="inline-icon" aria-hidden /> In practice
            </p>
            <h2>The flow your agents actually run</h2>
            <p className="muted">
              High-level walkthrough — not live account data. Integration templates, one MCP URL,
              workspace select, then namespaced tools.
            </p>
          </header>
          <ol className="product-flow-list">
            {PRODUCT_FLOW.map((step) => (
              <li key={step.n} className="product-flow-item">
                <span className="product-flow-n mono" aria-hidden>
                  {step.n}
                </span>
                <div className="product-flow-copy">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  <code className="product-flow-sample mono">{step.sample}</code>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="product-security" aria-label="Security model">
          <header className="section-head">
            <p className="section-label">
              <ShieldCheckIcon className="inline-icon" aria-hidden /> Security model
            </p>
            <h2>Encryption and control, not marketing claims</h2>
            <p className="muted">
              Designed so provider credentials stay out of agent context while remaining usable
              through MCP.
            </p>
          </header>
          <div className="security-grid">
            {SECURITY_POINTS.map((point) => (
              <article key={point.title} className="security-card panel">
                <h3>{point.title}</h3>
                <p>{point.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="product-compare" aria-label="Before and after">
          <header className="section-head">
            <p className="section-label">
              <ShieldCheckIcon className="inline-icon" aria-hidden /> Comparison
            </p>
            <h2>Same IDE. Provider keys stay out.</h2>
            <p className="muted">
              How teams typically handle secrets today versus through VaultMCP.
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
        </section>

        <section className="product-pillars">
          <header className="section-head">
            <p className="section-label">
              <UserGroupIcon className="inline-icon" aria-hidden /> Design constraints
            </p>
            <h2>What the system is built around</h2>
          </header>
          <div className="feature-strip">
            {PILLARS.map((p) => {
              const Icon = p.icon;
              return (
                <article key={p.title} className="feature">
                  <div className="feature-icon">
                    <Icon aria-hidden />
                  </div>
                  <h3>{p.title}</h3>
                  <p>{p.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="product-cta panel">
          <div>
            <h2>Connect once. Secrets stay in the vault.</h2>
            <p className="muted">
              Integrations wire providers; your IDE only talks to VaultMCP. Sign in with GitHub,
              create a workspace, then call namespaced tools safely.
            </p>
          </div>
          <div className="hero-cta">
            {user ? (
              <Link className="btn btn-primary btn-lg" to="/">
                Open workspaces
              </Link>
            ) : (
              <a className="btn btn-primary btn-lg" href={loginUrl()}>
                Get started
              </a>
            )}
            <Link className="link-quiet" to="/docs#self-host">
              Setup guide <ArrowRightIcon className="btn-icon" aria-hidden />
            </Link>
          </div>
        </section>
      </main>
      <Dock user={user} />
    </AppShell>
  );
}

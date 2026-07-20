import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
  CommandLineIcon,
  CubeTransparentIcon,
  KeyIcon,
  LockClosedIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { type User } from "./api";
import { Dock } from "./Dock";
import { AppShell } from "./Layout";

const TOC_GROUPS = [
  {
    label: "Start",
    items: [
      { id: "quickstart", label: "Quickstart" },
      { id: "self-host", label: "Self-host" },
      { id: "how-it-works", label: "How it works" },
    ],
  },
  {
    label: "Connect",
    items: [
      { id: "clients", label: "Connect your IDE" },
      { id: "local-env", label: "Local env (CLI)" },
    ],
  },
  {
    label: "Vault",
    items: [
      { id: "workspaces", label: "Workspaces" },
      { id: "secrets", label: "Secrets" },
      { id: "sharing", label: "Private vs shared" },
      { id: "upstreams", label: "Upstreams" },
    ],
  },
  {
    label: "Recipes",
    items: [
      { id: "aws", label: "AWS example" },
      { id: "multi-keys", label: "Many API keys" },
      { id: "gateway-tools", label: "Gateway tools" },
    ],
  },
  {
    label: "Ops",
    items: [
      { id: "security", label: "Security" },
      { id: "mfa", label: "MFA (TOTP)" },
      { id: "deploy", label: "Deploy" },
      { id: "troubleshoot", label: "Troubleshooting" },
      { id: "license", label: "License" },
    ],
  },
];

export function DocsPage({
  user,
  onLogout,
}: {
  user?: User | null;
  onLogout?: () => void;
}) {
  const location = useLocation();
  const [activeId, setActiveId] = useState("");

  useEffect(() => {
    const hash = location.hash.replace("#", "");
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    setActiveId(hash);
    const el = document.getElementById(hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.hash, location.pathname]);

  useEffect(() => {
    const ids = TOC_GROUPS.flatMap((g) => g.items.map((i) => i.id));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0.1, 0.4] },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <AppShell user={user} onLogout={onLogout}>
      <main className="shell docs-shell">
        <header className="page-header docs-page-header">
          <p className="section-label">
            <BookOpenIcon className="inline-icon" aria-hidden /> Documentation
          </p>
          <h1>VaultMCP docs</h1>
          <p>
            Store API keys once. Connect any MCP IDE to VaultMCP only. Secrets stay encrypted and
            inject server-side.
          </p>
        </header>

        <div className="docs-layout">
          <aside className="docs-toc panel">
            <p className="section-label">On this page</p>
            {TOC_GROUPS.map((group) => (
              <div key={group.label} className="docs-toc-group">
                <p className="docs-toc-group-label">{group.label}</p>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={`#${item.id}`}
                        className={activeId === item.id ? "is-active" : undefined}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="docs-toc-actions">
              {user ? (
                <Link className="btn btn-primary docs-signin" to="/">
                  Open workspaces
                </Link>
              ) : null}
              <Link className="btn btn-ghost docs-signin-secondary" to="/product">
                View product
              </Link>
            </div>
          </aside>

          <div className="docs-content stack">
            <section className="panel docs-section" id="quickstart">
              <h2>
                <BookOpenIcon className="inline-icon" aria-hidden /> Quickstart
              </h2>
              <p className="docs-lead">From a running VaultMCP instance to an agent that can call AWS.</p>
              <ol className="steps">
                <li>Sign in (GitHub OAuth) and create a workspace.</li>
                <li>
                  Add secrets (<span className="mono">AWS_*</span>, etc.). Shared = team; private =
                  only you.
                </li>
                <li>
                  Register an upstream via Integrations, using{" "}
                  <span className="mono">{"{{secret:NAME}}"}</span>.
                </li>
                <li>
                  Point the IDE at <span className="mono">/mcp</span>, authenticate, then{" "}
                  <span className="mono">use_workspace</span>.
                </li>
              </ol>
              <div className="docs-callout">
                <strong>Rule:</strong> if it would live in client MCP <span className="mono">env</span>
                , put it in VaultMCP instead.
              </div>
            </section>

            <section className="panel docs-section" id="self-host">
              <h2>
                <ServerStackIcon className="inline-icon" aria-hidden /> Self-host
              </h2>
              <p className="docs-lead">
                pnpm monorepo + Postgres + Redis. Local pnpm: API{" "}
                <span className="mono">:3001</span>, UI <span className="mono">:5173</span>.
              </p>

              <h3>Prerequisites</h3>
              <ul className="docs-list docs-list-tight">
                <li>Node.js 22+, pnpm 9</li>
                <li>Docker (Postgres + Redis) or local equivalents</li>
                <li>GitHub OAuth App</li>
              </ul>

              <h3>1. Clone and env</h3>
              <div className="code-block">{`git clone <your-fork-or-upstream-url>
cd vaultmcp
cp .env.example .env`}</div>
              <p>
                Required: <span className="mono">VAULT_MASTER_KEY</span>, GitHub OAuth pair,{" "}
                <span className="mono">PUBLIC_URL</span>, <span className="mono">WEB_ORIGIN</span>,{" "}
                <span className="mono">DATABASE_URL</span>, <span className="mono">REDIS_URL</span>.
                See <span className="mono">.env.example</span> and{" "}
                <span className="mono">docs/DEPLOY.md</span>.
              </p>

              <h3>2. GitHub OAuth App</h3>
              <ol className="steps">
                <li>
                  Create an app at{" "}
                  <a
                    href="https://github.com/settings/developers"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub Developer settings
                  </a>
                  .
                </li>
                <li>
                  Homepage = <span className="mono">WEB_ORIGIN</span>. Callback ={" "}
                  <span className="mono">{"{PUBLIC_URL}/auth/github/callback"}</span>.
                </li>
                <li>
                  Local pnpm callback:{" "}
                  <span className="mono">http://localhost:3001/auth/github/callback</span>
                </li>
              </ol>

              <h3>3. Run</h3>
              <div className="code-block">{`docker compose up -d postgres redis
pnpm install
pnpm --filter @vaultmcp/shared build
pnpm db:generate && pnpm db:migrate
pnpm dev:api    # :3001
pnpm dev:web    # :5173`}</div>
              <div className="docs-callout">
                <strong>Host note:</strong> AWS via <span className="mono">uvx</span> needs{" "}
                <span className="mono">uv</span> on the API host <span className="mono">PATH</span>{" "}
                (Docker image includes it).
              </div>
            </section>

            <section className="panel docs-section" id="how-it-works">
              <h2>
                <ServerStackIcon className="inline-icon" aria-hidden /> How it works
              </h2>
              <p className="docs-lead">
                VaultMCP sits between your IDE and real MCP servers. At tool call time it decrypts
                allowed secrets, injects them upstream, and returns the result — never the secret.
              </p>
              <div className="docs-grid-2">
                <div className="docs-card">
                  <h3>Control plane</h3>
                  <ul>
                    <li>GitHub login</li>
                    <li>Workspaces, members, roles</li>
                    <li>Secrets (write-only values)</li>
                    <li>Upstreams + audit</li>
                  </ul>
                </div>
                <div className="docs-card">
                  <h3>MCP gateway</h3>
                  <ul>
                    <li>
                      <span className="mono">/mcp</span> Streamable HTTP
                    </li>
                    <li>OAuth 2.1 + PKCE, or <span className="mono">vmcp_…</span> PAT</li>
                    <li>
                      Tools as <span className="mono">slug__tool</span>
                    </li>
                    <li>Server-side injection</li>
                  </ul>
                </div>
              </div>
            </section>

            <section className="panel docs-section" id="clients">
              <h2>
                <CommandLineIcon className="inline-icon" aria-hidden /> Connect your IDE
              </h2>
              <p className="docs-lead">
                Streamable HTTP at <span className="mono">/mcp</span>. Local:{" "}
                <span className="mono">http://localhost:3001/mcp</span>. Do not put provider tokens in
                client config.
              </p>

              <div className="docs-auth-split">
                <div className="docs-card">
                  <h3>GitHub OAuth</h3>
                  <p>URL only. IDE opens a browser.</p>
                </div>
                <div className="docs-card">
                  <h3>Personal token</h3>
                  <p>
                    <span className="mono">Authorization: Bearer vmcp_…</span> — skip the browser.
                  </p>
                </div>
              </div>

              <h3>OAuth config</h3>
              <div className="code-block">{`{
  "mcpServers": {
    "vaultmcp": {
      "url": "http://YOUR_SERVER_IP/mcp"
    }
  }
}`}</div>

              <h3>Token config</h3>
              <div className="code-block">{`{
  "mcpServers": {
    "vaultmcp": {
      "url": "http://YOUR_SERVER_IP/mcp",
      "headers": {
        "Authorization": "Bearer vmcp_…"
      }
    }
  }
}`}</div>

              <ol className="steps">
                <li>Save MCP URL (and optional token headers) in the IDE.</li>
                <li>OAuth: complete Connect. Token: skip browser.</li>
                <li>
                  <span className="mono">list_workspaces</span> →{" "}
                  <span className="mono">use_workspace</span> with your slug.
                </li>
                <li>
                  Call <span className="mono">github__*</span> / <span className="mono">aws__*</span>.
                  Cursor logs may show <span className="mono">user-vaultmcp</span> — same gateway.
                </li>
              </ol>

              <details className="docs-details">
                <summary>Cursor naming tip</summary>
                <p>
                  Keep the config key <span className="mono">"vaultmcp"</span>. Cursor prefixes user
                  servers with <span className="mono">user-</span> in logs. That is expected.
                </p>
              </details>
            </section>

            <section className="panel docs-section" id="local-env">
              <h2>
                <CommandLineIcon className="inline-icon" aria-hidden /> Local env (CLI)
              </h2>
              <p className="docs-lead">
                Share workspace secrets with developers without redistributing{" "}
                <span className="mono">.env</span> files. Package:{" "}
                <span className="mono">@vaultmcp-axiler/cli</span>.
              </p>

              <div className="docs-auth-split">
                <div className="docs-card">
                  <h3>MCP PAT</h3>
                  <p>
                    Authenticates <span className="mono">/mcp</span>. Secrets stay server-side.
                  </p>
                </div>
                <div className="docs-card">
                  <h3>Runtime env PAT</h3>
                  <p>
                    <span className="mono">env</span> scope only. Exports plaintext to the laptop.
                  </p>
                </div>
              </div>

              <ol className="steps">
                <li>Store team secrets as shared in the workspace.</li>
                <li>
                  Create a <strong>Runtime env (CLI)</strong> token on Connect.
                </li>
                <li>
                  On each laptop:
                  <div className="code-block">{`npx @vaultmcp-axiler/cli@latest login --token vmcp_… --url https://your-host
npx @vaultmcp-axiler/cli@latest run -w your-slug -- npm run dev`}</div>
                </li>
                <li>Rotate in the dashboard; teammates restart to pick up changes.</li>
              </ol>

              <div className="docs-callout">
                <strong>Trust:</strong> prefer <span className="mono">vaultmcp run</span> over{" "}
                <span className="mono">vaultmcp env</span> (prints secrets). Revoke on offboarding.
              </div>
            </section>

            <section className="panel docs-section" id="workspaces">
              <h2>
                <Squares2X2Icon className="inline-icon" aria-hidden /> Workspaces
              </h2>
              <p className="docs-lead">
                Boundary for secrets, upstreams, members, and audit. Model like environments or
                teams.
              </p>
              <div className="docs-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Example</th>
                      <th>Who</th>
                      <th>Typical secrets</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>personal-you</td>
                      <td>Only you</td>
                      <td>Personal keys</td>
                    </tr>
                    <tr>
                      <td>acme-staging</td>
                      <td>Eng team</td>
                      <td>Staging AWS / bots</td>
                    </tr>
                    <tr>
                      <td>acme-prod-ro</td>
                      <td>On-call</td>
                      <td>Prod read-only IAM</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Roles: <span className="mono">owner</span>, <span className="mono">admin</span>,{" "}
                <span className="mono">member</span>, <span className="mono">viewer</span>. Set a
                default workspace so new MCP sessions start there.
              </p>
            </section>

            <section className="panel docs-section" id="secrets">
              <h2>
                <KeyIcon className="inline-icon" aria-hidden /> Secrets
              </h2>
              <p className="docs-lead">
                Names are identifiers. Values use <strong>envelope encryption</strong>: AES-256-GCM
                under a per-workspace data key (DEK), wrapped by{" "}
                <span className="mono">VAULT_MASTER_KEY</span>. List APIs return metadata only.
              </p>
              <ul className="docs-list">
                <li>
                  Prefer uppercase env-style names:{" "}
                  <span className="mono">ANTHROPIC_API_KEY</span>.
                </li>
                <li>Rotate anytime in the UI — values are never shown back.</li>
                <li>
                  Names and tags stay readable for wiring; only secret <em>values</em> are
                  ciphertext (see <a href="#security">Security</a>).
                </li>
              </ul>
            </section>

            <section className="panel docs-section" id="sharing">
              <h2>
                <UserGroupIcon className="inline-icon" aria-hidden /> Private vs shared
              </h2>
              <div className="docs-grid-2">
                <div className="docs-card">
                  <h3>Private</h3>
                  <p>Only the creator can inject. Teammates cannot use it.</p>
                </div>
                <div className="docs-card">
                  <h3>Shared</h3>
                  <p>
                    Any <span className="mono">member+</span> can inject for that workspace’s
                    upstreams.
                  </p>
                </div>
              </div>
              <p>
                Invites use GitHub username. Invitee must sign in once before you can add them.
              </p>
            </section>

            <section className="panel docs-section" id="upstreams">
              <h2>
                <CubeTransparentIcon className="inline-icon" aria-hidden /> Upstreams
              </h2>
              <p className="docs-lead">
                A proxied MCP server. Use stdio (<span className="mono">uvx</span>,{" "}
                <span className="mono">npx</span>) or http. Placeholders:
              </p>
              <div className="code-block">{`"AWS_ACCESS_KEY_ID": "{{secret:AWS_ACCESS_KEY_ID}}"`}</div>
              <p>
                Tools appear as <span className="mono">{"{slug}__{toolName}"}</span>. Keep slugs
                short (<span className="mono">aws</span>, <span className="mono">github</span>).
              </p>
            </section>

            <section className="panel docs-section" id="aws">
              <h2>
                <ArrowTopRightOnSquareIcon className="inline-icon" aria-hidden /> AWS example
              </h2>
              <p className="docs-lead">
                Template uses <span className="mono">awslabs.aws-api-mcp-server</span> via{" "}
                <span className="mono">uvx</span>.
              </p>
              <ol className="steps">
                <li>
                  Create <span className="mono">AWS_ACCESS_KEY_ID</span>,{" "}
                  <span className="mono">AWS_SECRET_ACCESS_KEY</span>,{" "}
                  <span className="mono">AWS_REGION</span> (shared for teammates).
                </li>
                <li>Integrations → AWS → Add.</li>
                <li>
                  IDE: auth → <span className="mono">use_workspace</span> →{" "}
                  <span className="mono">aws__*</span>.
                </li>
              </ol>
              <details className="docs-details">
                <summary>Upstream JSON</summary>
                <div className="code-block">{`{
  "name": "AWS",
  "slug": "aws",
  "transport": "stdio",
  "command": "uvx",
  "args": ["awslabs.aws-api-mcp-server@latest"],
  "envTemplate": {
    "AWS_ACCESS_KEY_ID": "{{secret:AWS_ACCESS_KEY_ID}}",
    "AWS_SECRET_ACCESS_KEY": "{{secret:AWS_SECRET_ACCESS_KEY}}",
    "AWS_REGION": "{{secret:AWS_REGION}}",
    "FASTMCP_LOG_LEVEL": "ERROR"
  }
}`}</div>
              </details>
            </section>

            <section className="panel docs-section" id="multi-keys">
              <h2>
                <KeyIcon className="inline-icon" aria-hidden /> Many API keys
              </h2>
              <p className="docs-lead">
                One workspace (or one per environment), one upstream per MCP server. Switch with{" "}
                <span className="mono">use_workspace</span> — not by swapping keys in the IDE.
              </p>
              <div className="docs-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Secrets</th>
                      <th>Visibility</th>
                      <th>Upstream</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>ANTHROPIC_API_KEY</td>
                      <td>private or shared</td>
                      <td>Agent MCP if used</td>
                    </tr>
                    <tr>
                      <td>AWS_* </td>
                      <td>shared staging; restricted prod</td>
                      <td>
                        <span className="mono">aws</span>
                      </td>
                    </tr>
                    <tr>
                      <td>GITHUB_TOKEN</td>
                      <td>private PAT or bot</td>
                      <td>
                        <span className="mono">github</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel docs-section" id="gateway-tools">
              <h2>
                <CommandLineIcon className="inline-icon" aria-hidden /> Gateway tools
              </h2>
              <p className="docs-lead">Always available alongside upstream tools:</p>
              <div className="docs-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tool</th>
                      <th>Purpose</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>list_workspaces</td>
                      <td>Workspaces you can access</td>
                    </tr>
                    <tr>
                      <td>use_workspace</td>
                      <td>Select by slug or id</td>
                    </tr>
                    <tr>
                      <td>current_workspace</td>
                      <td>Session selection</td>
                    </tr>
                    <tr>
                      <td>list_upstreams / list_secrets</td>
                      <td>Metadata only</td>
                    </tr>
                    <tr>
                      <td>list_templates / apply_integration</td>
                      <td>Install from catalog (write)</td>
                    </tr>
                    <tr>
                      <td>put_secret / delete_secret</td>
                      <td>Manage secrets (write)</td>
                    </tr>
                    <tr>
                      <td>upsert_upstream</td>
                      <td>Register upstream (write + admin)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel docs-section" id="security">
              <h2>
                <ShieldCheckIcon className="inline-icon" aria-hidden /> Security
              </h2>
              <ul className="docs-list">
                <li>
                  <LockClosedIcon className="inline-icon" aria-hidden /> Envelope encryption:
                  per-workspace AES-256-GCM DEKs, wrapped by{" "}
                  <span className="mono">VAULT_MASTER_KEY</span> (kept out of the database).
                </li>
                <li>
                  Ciphertext is bound to the workspace (GCM AAD) so blobs cannot be swapped across
                  vaults.
                </li>
                <li>
                  Plaintext never in tool results, audit, or list APIs — except intentional{" "}
                  <Link to="/docs#local-env">runtime env export</Link>.
                </li>
                <li>Decryption only at the injection boundary after membership checks.</li>
                <li>Client config holds only the VaultMCP URL.</li>
                <li>
                  Optional authenticator MFA (TOTP) for the dashboard after GitHub sign-in.
                </li>
                <li>
                  Production: TLS, <span className="mono">COOKIE_SECURE=true</span>, restrict
                  invites.
                </li>
              </ul>
            </section>

            <section className="panel docs-section" id="mfa">
              <h2>
                <ShieldCheckIcon className="inline-icon" aria-hidden /> MFA (TOTP)
              </h2>
              <p className="docs-lead">
                Optional authenticator-app MFA for the <strong>dashboard</strong> after GitHub
                sign-in. MCP OAuth / PATs for IDEs are unchanged — this gates the control plane
                only.
              </p>
              <ol className="steps">
                <li>Sign in with GitHub, open Account → Security (or MFA settings).</li>
                <li>Scan the QR code with Authy, 1Password, Google Authenticator, etc.</li>
                <li>Confirm with a 6-digit code to enable. On later sign-ins you will be asked
                  for a code before workspaces load.</li>
              </ol>
              <p>
                Disable anytime from the same settings page (requires a valid code). Prefer keeping
                MFA on for accounts that can mint PATs or manage shared secrets.
              </p>
            </section>

            <section className="panel docs-section" id="deploy">
              <h2>
                <ServerStackIcon className="inline-icon" aria-hidden /> Deploy
              </h2>
              <p className="docs-lead">
                See <a href="#self-host">Self-host</a>. Production: Docker Compose + reverse proxy
                on port 80 (<span className="mono">docs/DEPLOY.md</span>).
              </p>
              <ul className="docs-list">
                <li>
                  Required env: master key, GitHub OAuth,{" "}
                  <span className="mono">PUBLIC_URL</span> / <span className="mono">WEB_ORIGIN</span>
                  .
                </li>
                <li>
                  Public entry: UI, <span className="mono">/health</span>,{" "}
                  <span className="mono">/mcp</span>.
                </li>
                <li>
                  Domain: HTTPS origins, <span className="mono">COOKIE_SECURE=true</span>, update
                  OAuth App, redeploy.
                </li>
              </ul>
            </section>

            <section className="panel docs-section" id="troubleshoot">
              <h2>
                <ShieldCheckIcon className="inline-icon" aria-hidden /> Troubleshooting
              </h2>
              <div className="docs-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Symptom</th>
                      <th>Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>GitHub login fails</td>
                      <td>Client ID/secret, callback, PUBLIC_URL</td>
                    </tr>
                    <tr>
                      <td>Needs authentication</td>
                      <td>
                        Complete OAuth; URL ends with <span className="mono">/mcp</span>
                      </td>
                    </tr>
                    <tr>
                      <td>Upstream unavailable</td>
                      <td>Secret names match; command on PATH; member+</td>
                    </tr>
                    <tr>
                      <td>Teammate can’t use AWS</td>
                      <td>Secrets shared; invited; same workspace</td>
                    </tr>
                    <tr>
                      <td>Invite 404</td>
                      <td>Invitee must sign in once first</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="docs-callout">
                <strong>Still stuck?</strong> <span className="mono">/health</span> + Advanced →
                Audit (no secret values logged).
              </div>
            </section>

            <section className="panel docs-section" id="license">
              <h2>
                <BookOpenIcon className="inline-icon" aria-hidden /> License
              </h2>
              <p>
                Free software by Axiler Labs under <strong>AGPL-3.0-only</strong>. See{" "}
                <span className="mono">LICENSE</span>. Network use requires providing corresponding
                source.
              </p>
            </section>
          </div>
        </div>
      </main>
      <Dock user={user} />
    </AppShell>
  );
}

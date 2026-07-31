# Landing Perf + GitHub Link + SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the public landing immediately (no auth-gate spinner), add a GitHub open-source link on the landing/nav, and expand static SEO meta in `index.html`.

**Architecture:** Stop blocking `App` render on `api.me()`. Default to logged-out public UI, then upgrade to authenticated shell when the session returns. Add one shared repo URL constant for nav + hero. Enrich `index.html` head with canonical, OG/Twitter, and JSON-LD — no prerender/SSR.

**Tech Stack:** Vite + React 19 + React Router 7, static `index.html` meta.

## Global Constraints

- Repo URL: `https://github.com/Axiler-Lab/vaultmcp` (exact)
- Canonical site: `https://vaultmcp.dev/`
- No prerender/SSR (Option A only)
- No new test framework — web package has no unit tests; verify with `pnpm --filter @vaultmcp/web typecheck` and manual browser check
- Do not commit unless the user explicitly asks
- Match existing styles (`nav-link`, `btn-ghost` / `link-quiet`); no new design system

## File map

| File | Responsibility |
|------|----------------|
| `apps/web/src/App.tsx` | Auth bootstrap gate + hero GitHub CTA + `GITHUB_REPO_URL` constant |
| `apps/web/src/Layout.tsx` | Nav GitHub link (logged-out and logged-in) |
| `apps/web/index.html` | Static SEO (title, description, canonical, OG, Twitter, JSON-LD) |

---

### Task 1: Render public UI without waiting on `/auth/me`

**Files:**
- Modify: `apps/web/src/App.tsx` (`App` function, ~lines 587–663)

**Interfaces:**
- Consumes: `api.me()` → `{ user: User; mfaRequired: boolean; mfaSatisfied: boolean }` (existing)
- Produces: `App` renders public routes when `user` is `null`; authenticated routes when `user` is set; MFA gate when `mfaRequired`

- [ ] **Step 1: Replace the loading gate in `App`**

In `apps/web/src/App.tsx`, change `App` so `user` defaults to `null` (logged-out assumption) instead of `undefined`, remove the early return that shows only the loading screen, and keep the existing `api.me()` effect:

```tsx
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
```

Delete the unused `loading-screen` early-return block entirely. Leave `.loading-screen` CSS in place (harmless; may still be useful elsewhere later).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @vaultmcp/web typecheck`  
Expected: exit 0, no type errors

- [ ] **Step 3: Manual verify (dev server if already running, else start)**

- Cold load logged out: landing appears immediately (no “Loading VaultMCP…” flash waiting on API).
- If signed in: may briefly see landing, then Home/MFA.

---

### Task 2: GitHub open-source link (hero + nav)

**Files:**
- Modify: `apps/web/src/App.tsx` (constant + hero CTA)
- Modify: `apps/web/src/Layout.tsx` (`SiteNav`)

**Interfaces:**
- Consumes: existing `GitHubMark` in `App.tsx`
- Produces: `GITHUB_REPO_URL` constant exported or duplicated once in App and imported… prefer a single constant in `App.tsx` is awkward for Layout. Put the constant in `apps/web/src/App.tsx` is wrong for Layout. **Define in `Layout.tsx` as `export const GITHUB_REPO_URL = "https://github.com/Axiler-Lab/vaultmcp"` and import it from `App.tsx`**, OR define locally in both files as the same string literal. Prefer one export from `Layout.tsx` (nav owns the chrome link) and import in `App.tsx`.

- [ ] **Step 1: Add repo constant + nav link in `Layout.tsx`**

At top of `apps/web/src/Layout.tsx` (after imports):

```tsx
export const GITHUB_REPO_URL = "https://github.com/Axiler-Lab/vaultmcp";
```

In both logged-out and logged-in `<nav className="nav-links">` blocks, add after Docs (and after Clients for logged-out):

```tsx
<a
  className="nav-link"
  href={GITHUB_REPO_URL}
  target="_blank"
  rel="noopener noreferrer"
>
  GitHub
</a>
```

Full logged-out nav links become: Product, Docs, Clients, GitHub.  
Full logged-in nav links become: Workspaces, Product, Docs, GitHub.

- [ ] **Step 2: Hero secondary CTA in `LoginPage`**

In `apps/web/src/App.tsx`, import `GITHUB_REPO_URL` from `./Layout` (already imports `Dock`, `AppShell`, `Aurora`, `SiteNav` from `./Layout` — extend that import).

Change the hero CTA block to:

```tsx
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
```

Use “Open source” (not “GitHub”) so it is distinct from the OAuth “Get started” button that already uses the GitHub mark.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @vaultmcp/web typecheck`  
Expected: exit 0

- [ ] **Step 4: Manual verify**

- Nav “GitHub” and hero “Open source” open `https://github.com/Axiler-Lab/vaultmcp` in a new tab.

---

### Task 3: Static SEO in `index.html`

**Files:**
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: public assets at `/assets/logo/vaultmcp-wordmark.png`
- Produces: richer document head for crawlers/social previews

- [ ] **Step 1: Replace the `<head>` content**

Replace `apps/web/index.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>VaultMCP — credential vault for AI coding agents</title>
    <meta
      name="description"
      content="Open-source remote MCP credential vault. Connect any AI IDE once. Anthropic, AWS, GitHub and other secrets stay encrypted server-side — never pasted into your tools."
    />
    <link rel="canonical" href="https://vaultmcp.dev/" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png" />

    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://vaultmcp.dev/" />
    <meta property="og:title" content="VaultMCP — credential vault for AI coding agents" />
    <meta
      property="og:description"
      content="Open-source remote MCP credential vault. Connect any AI IDE once. Secrets stay encrypted server-side."
    />
    <meta
      property="og:image"
      content="https://vaultmcp.dev/assets/logo/vaultmcp-wordmark.png"
    />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="VaultMCP — credential vault for AI coding agents" />
    <meta
      name="twitter:description"
      content="Open-source remote MCP credential vault. Connect any AI IDE once. Secrets stay encrypted server-side."
    />
    <meta
      name="twitter:image"
      content="https://vaultmcp.dev/assets/logo/vaultmcp-wordmark.png"
    />

    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "VaultMCP",
        "applicationCategory": "DeveloperApplication",
        "operatingSystem": "Web",
        "url": "https://vaultmcp.dev/",
        "description": "Open-source remote MCP credential vault for AI coding agents. Secrets stay encrypted server-side.",
        "codeRepository": "https://github.com/Axiler-Lab/vaultmcp",
        "license": "https://www.gnu.org/licenses/agpl-3.0.html"
      }
    </script>

    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Build check**

Run: `pnpm --filter @vaultmcp/web build`  
Expected: exit 0; built `index.html` in `apps/web/dist` still contains canonical, og tags, and JSON-LD.

- [ ] **Step 3: Spot-check built head**

Run: `rg -n "canonical|og:title|codeRepository|Open source" apps/web/dist/index.html apps/web/src/App.tsx apps/web/src/Layout.tsx`  
Expected: matches for SEO strings in dist, and GitHub/Open source links in source.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Public landing without waiting on `me` | Task 1 |
| Brief flash OK for signed-in users | Task 1 (documented trade-off) |
| Hero GitHub / open-source CTA | Task 2 |
| Nav GitHub link (logged-out + logged-in) | Task 2 |
| Canonical, OG, Twitter, JSON-LD | Task 3 |
| No prerender/SSR | Global constraints |

No placeholders. Types match existing `User` / `api.me()` shapes.

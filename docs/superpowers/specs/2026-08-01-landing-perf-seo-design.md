# Landing load, GitHub link, and SEO

Date: 2026-08-01  
Status: approved for planning  
Scope: Option A — quick wins only (no prerender/SSR)

## Problem

Anonymous visitors see “Loading VaultMCP…” until `api.me()` finishes (or times out at 4s). The landing is blocked by session bootstrap even though it does not need auth.

SEO today is minimal static tags in `apps/web/index.html`. There is no visible open-source GitHub link on the landing.

## Goals

1. Show the public landing immediately; session check runs in the background.
2. Link to the open-source repo (`https://github.com/Axiler-Lab/vaultmcp`) from the landing.
3. Improve static SEO meta in `index.html` (Open Graph, Twitter, canonical, JSON-LD).

## Non-goals

- Prerendering or SSR
- Changing auth/API behavior server-side
- New analytics or sitemap infrastructure

## Design

### 1. Auth bootstrap (faster landing)

**Current:** `user` starts as `undefined`; while undefined, `App` renders only a loading screen. Public routes never mount until `/auth/me` resolves.

**Change:**

- Keep fetching `api.me()` on mount with the existing timeout.
- Render public routes (`LoginPage`, `/product`, `/docs`) immediately without waiting for the session.
- When `me` succeeds with a user, switch to the authenticated shell (and MFA gate when `mfaRequired`).
- When `me` fails or times out, stay on the public landing (same as today after catch).

**UX trade-off:** Signed-in users may briefly see the landing before Home. Acceptable for Option A when the API is healthy (usually sub-second).

**Implementation sketch (`App.tsx`):**

- Replace the global `if (user === undefined) return <loading>` gate.
- Use something like `user: User | null` (default `null`) plus optional `authChecked` only if MFA/Home needs a distinct waiting state.
- Prefer: default to logged-out UI; upgrade when session arrives. MFA gate only after a successful `me` that reports `mfaRequired`.

### 2. GitHub open-source link

**URL:** `https://github.com/Axiler-Lab/vaultmcp`  
**Target:** `_blank` with `rel="noopener noreferrer"`

**Placement:**

1. Hero CTA row: secondary control next to “Get started” (reuse `GitHubMark` + label “GitHub” or “Open source”).
2. Logged-out `SiteNav`: text/icon link to the same URL (alongside Product / Docs).
3. Logged-in nav: same link if it fits without crowding; otherwise logged-out + hero is enough.

Reuse existing button/link styles (`btn-ghost` / `link-quiet` / `nav-link`); no new visual system.

### 3. SEO (`apps/web/index.html`)

Static head only:

- Stronger `<title>` and `<meta name="description">`
- `<link rel="canonical" href="https://vaultmcp.dev/" />`
- Open Graph: `og:type`, `og:url`, `og:title`, `og:description`, `og:image` (absolute URL to an existing logo asset on vaultmcp.dev)
- Twitter card: `summary_large_image` + matching title/description/image
- JSON-LD `SoftwareApplication` (name, description, url, `codeRepository` → GitHub)

Do not add prerender, robots.txt changes, or per-route React Helmet unless already present (it is not).

## Files touched (expected)

- `apps/web/src/App.tsx` — auth gate + hero GitHub CTA
- `apps/web/src/Layout.tsx` — nav GitHub link
- `apps/web/index.html` — SEO meta + JSON-LD
- Minor CSS only if hero/nav spacing needs a tweak

## Testing

- Cold load logged out: landing visible without waiting on API; no stuck loading screen if API is down (timeout still clears).
- Logged in: brief public flash then Home/MFA as appropriate.
- GitHub links open the Axiler-Lab repo.
- View source / social debugger: meta and JSON-LD present on the document shell.

## Out of scope follow-ups

- Option B: prerender landing HTML for crawlers
- Option C: SSR

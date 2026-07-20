import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { loginUrl, type User } from "./api";

export function Aurora() {
  return <div className="aurora" aria-hidden />;
}

export function BrandLogo({ className }: { className?: string }) {
  return (
    <Link to="/" className={`brand ${className ?? ""}`.trim()}>
      <img
        className="brand-logo"
        src="/assets/logo/vaultmcp-mark.png"
        alt=""
        width={28}
        height={28}
      />
      <span className="brand-text">
        Vault<span>MCP</span>
      </span>
    </Link>
  );
}

export function SiteNav({
  user,
  onLogout,
}: {
  user?: User | null;
  onLogout?: () => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-nav ${scrolled ? "scrolled" : ""}`}>
      <div className="nav-left">
        <BrandLogo />
        <nav className="nav-links" aria-label="Primary">
          {user ? (
            <>
              <Link className="nav-link" to="/">
                Workspaces
              </Link>
              <Link className="nav-link" to="/product">
                Product
              </Link>
              <Link className="nav-link" to="/docs">
                Docs
              </Link>
            </>
          ) : (
            <>
              <Link className="nav-link" to="/product">
                Product
              </Link>
              <Link className="nav-link" to="/docs">
                Docs
              </Link>
              <Link className="nav-link" to="/docs#clients">
                Clients
              </Link>
            </>
          )}
        </nav>
      </div>
      <div className="nav-right">
        {user ? (
          <div className="user-chip">
            {user.avatarUrl && <img src={user.avatarUrl} alt="" />}
            <span>@{user.githubLogin}</span>
            {onLogout && (
              <button type="button" className="btn btn-ghost" onClick={onLogout}>
                Sign out
              </button>
            )}
          </div>
        ) : (
          <a className="btn btn-primary" href={loginUrl()}>
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

export function AppShell({
  user,
  onLogout,
  children,
  showAurora = true,
}: {
  user?: User | null;
  onLogout?: () => void;
  children: ReactNode;
  showAurora?: boolean;
}) {
  return (
    <div className="app-root">
      {showAurora && <Aurora />}
      <SiteNav user={user} onLogout={onLogout} />
      {children}
    </div>
  );
}

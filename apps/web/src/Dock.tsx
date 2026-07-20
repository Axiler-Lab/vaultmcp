import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpenIcon,
  CommandLineIcon,
  CubeTransparentIcon,
  HomeIcon,
  LockClosedIcon,
  Squares2X2Icon,
  UserGroupIcon,
} from "@heroicons/react/24/outline";
import { loginUrl, type User } from "./api";

type DockItem = {
  id: string;
  label: string;
  hint: string;
  icon: typeof HomeIcon;
  to?: string;
  hash?: string;
  action?: "signin";
};

function buildItems(user: User | null | undefined): DockItem[] {
  const items: DockItem[] = [];
  if (!user) {
    items.push({
      id: "home",
      label: "Home",
      hint: "Landing & overview",
      icon: HomeIcon,
      to: "/",
    });
  }
  items.push(
    {
      id: "features",
      label: "Product",
      hint: "Lifecycle & how VaultMCP works",
      icon: CubeTransparentIcon,
      to: "/product",
    },
    {
      id: "docs",
      label: "Docs",
      hint: "Guides and IDE setup",
      icon: BookOpenIcon,
      to: "/docs",
    },
    {
      id: "workspaces",
      label: "Workspaces",
      hint: user ? "Your vaults & secrets" : "Sign in to manage workspaces",
      icon: Squares2X2Icon,
      to: user ? "/" : undefined,
      action: user ? undefined : "signin",
    },
    {
      id: "clients",
      label: "Clients",
      hint: "MCP config for any AI IDE",
      icon: CommandLineIcon,
      to: "/docs",
      hash: "clients",
    },
    {
      id: "teams",
      label: "Sharing",
      hint: "Private vs shared secrets",
      icon: UserGroupIcon,
      to: "/docs",
      hash: "sharing",
    },
    {
      id: "vault",
      label: "Security",
      hint: "What never leaves the server",
      icon: LockClosedIcon,
      to: "/docs",
      hash: "security",
    },
  );
  return items;
}

function scrollToHash(hash: string) {
  window.requestAnimationFrame(() => {
    document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

export function Dock({ user }: { user?: User | null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const items = buildItems(user);
  const trackRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeId, setActiveId] = useState("home");
  const [slider, setSlider] = useState({ left: 4, width: 40 });
  const [hint, setHint] = useState<string | null>(null);

  function resolveActive(): string {
    if (location.pathname.startsWith("/product")) return "features";
    if (location.pathname.startsWith("/docs")) {
      const hash = location.hash.replace("#", "");
      if (hash === "clients" || hash === "cursor") return "clients";
      if (hash === "sharing") return "teams";
      if (hash === "security") return "vault";
      return "docs";
    }
    if (location.pathname.startsWith("/workspaces")) return "workspaces";
    if (location.pathname === "/") return user ? "workspaces" : "home";
    return user ? "workspaces" : "home";
  }

  useEffect(() => {
    setActiveId(resolveActive());
  }, [location.pathname, location.hash, user]);

  function measure() {
    const idx = items.findIndex((i) => i.id === activeId);
    const el = btnRefs.current[idx];
    const track = trackRef.current;
    if (!el || !track) return;
    const trackBox = track.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setSlider({ left: box.left - trackBox.left, width: box.width });
    // Keep active item in view on narrow screens
    const overflowLeft = box.left - trackBox.left - 8;
    const overflowRight = box.right - trackBox.right + 8;
    if (overflowLeft < 0) track.scrollBy({ left: overflowLeft, behavior: "smooth" });
    if (overflowRight > 0) track.scrollBy({ left: overflowRight, behavior: "smooth" });
  }

  useLayoutEffect(() => {
    measure();
  }, [activeId, items.length, location.pathname]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  function go(item: DockItem) {
    setActiveId(item.id);
    setHint(item.hint);
    window.setTimeout(() => setHint(null), 2400);

    if (item.action === "signin") {
      window.location.href = loginUrl();
      return;
    }
    if (!item.to) return;

    if (item.hash) {
      navigate(`${item.to}#${item.hash}`);
      if (location.pathname === item.to) scrollToHash(item.hash);
      else {
        window.setTimeout(() => scrollToHash(item.hash!), 80);
      }
      return;
    }

    navigate(item.to);
    if (item.to === "/") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const activeItem = items.find((i) => i.id === activeId);

  return (
    <div className="dock-wrap">
      <div className={`dock-tooltip ${hint ? "visible" : ""}`} role="status">
        <strong>{activeItem?.label ?? ""}</strong>
        <span>{hint ?? activeItem?.hint ?? ""}</span>
      </div>
      <nav className="dock" aria-label="Primary dock">
        <div className="dock-track" ref={trackRef}>
          <span
            className="dock-slider"
            style={{
              transform: `translateX(${slider.left}px)`,
              width: slider.width,
            }}
            aria-hidden
          />
          {items.map((item, idx) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`dock-item ${activeId === item.id ? "active" : ""}`}
                title={item.label}
                aria-label={item.label}
                aria-current={activeId === item.id ? "page" : undefined}
                ref={(el) => {
                  btnRefs.current[idx] = el;
                }}
                onMouseEnter={() => setHint(item.hint)}
                onMouseLeave={() => setHint(null)}
                onFocus={() => setHint(item.hint)}
                onBlur={() => setHint(null)}
                onClick={() => go(item)}
              >
                <Icon className="dock-icon" aria-hidden />
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

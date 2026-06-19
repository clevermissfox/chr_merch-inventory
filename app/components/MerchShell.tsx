import type { ReactNode } from "react";
import { NavLink, useMatches } from "react-router";

const navItems = [
  { to: "/", label: "Dashboard" },
  { to: "/products", label: "Products" },
  { to: "/inventory", label: "Inventory" },
];

type MerchShellProps = {
  children?: ReactNode;
};

export function MerchShell({ children }: MerchShellProps) {
  const matches = useMatches();

  // Find the active child route's data
  const currentMatch = [...matches]
    .reverse()
    .find((match) => (match.handle as any)?.title);

  const currentHandle = (currentMatch?.handle as any) || {};
  const routeTitle = currentHandle.title || "Merch Dashboard";
  const routeEyebrow = currentHandle.eyebrow || "";
  const routeKicker = currentHandle.kicker || "";

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.href = "/";
      } else {
        console.error("Logout failed");
      }
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  return (
    <div className="merch-page">
      <header className="merch-topbar surface-primary ">
        <div className="wrapper grid gap-1 padding-i-default padding-b-2">
          <div className="row jc-sb gap-1">
            <div className="merch-brand">
              <div className="merch-brand__meta">
                <p className="merch-brand__eyebrow">CHR Merch</p>
                <h1 className="merch-brand__title">Merch Hub</h1>
              </div>
            </div>
            <button
              type="button"
              className="btn-logout btn-icon margin-is-auto"
              onClick={handleLogout}
              aria-label="Logout"
              title="Logout"
            >
              <i className="bi bi-box-arrow-right" aria-hidden="true"></i>
            </button>
          </div>
          <nav className="merch-nav" aria-label="Merch sections">
            {navItems.map((item) => (
              <NavLink
                key={item.label}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `merch-nav__link${isActive ? " is-active" : ""}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="merch-stage wrapper grid gap-1 margin-bs-1">
        <section className="merch-hero card">
          {routeEyebrow && (
            <p className="merch-hero__eyebrow">{routeEyebrow}</p>
          )}
          <h2 className="merch-hero__title">{routeTitle}</h2>
          {routeKicker ? (
            <p className="merch-hero__kicker">{routeKicker}</p>
          ) : null}
        </section>
        {children && <div className="merch-content">{children}</div>}
      </main>
    </div>
  );
}

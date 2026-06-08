import type { ReactNode } from "react";
import { NavLink } from "react-router";

const navItems = [
  { to: "/merch", label: "Dashboard" },
  { to: "/merch/products", label: "Products" },
  { to: "/merch/inventory", label: "Inventory" },
];

type MerchShellProps = {
  title: string;
  eyebrow: string;
  children: ReactNode;
  kicker?: string;
};

export function MerchShell({
  title,
  eyebrow,
  children,
  kicker,
}: MerchShellProps) {
  return (
    <div className="merch-page">
      <header className="merch-topbar">
        <div className="merch-brand">
          <div className="merch-brand__meta">
            <p className="merch-brand__eyebrow">CHR Merch</p>
            <h1 className="merch-brand__title">Merch Hub</h1>
          </div>
        </div>

        <nav className="merch-nav" aria-label="Merch sections">
          {navItems.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/merch"}
              className={({ isActive }) =>
                `merch-nav__link${isActive ? " is-active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="merch-stage">
        <section className="merch-hero card">
          <p className="merch-hero__eyebrow">{eyebrow}</p>
          <h2 className="merch-hero__title">{title}</h2>
          {kicker ? <p className="merch-hero__kicker">{kicker}</p> : null}
        </section>

        <div className="merch-content">{children}</div>
      </main>
    </div>
  );
}

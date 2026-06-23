import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { NavLink, useMatches } from "react-router";
import { useAuth } from "~/context/AuthContext";
import DialogUserProfile from "./DialogUserProfile";
import { LogOut, User } from "lucide-react";

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
  const { user } = useAuth();
  const userInitials = `${user?.givenName?.slice(0, 1) || "G"}${user?.familyName?.slice(0, 1) || ""}`;

  const [showProfile, setShowProfile] = useState(false);
  const [imgError, setImgError] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const popover = popoverRef.current;
    const btn = btnRef.current;
    if (!popover || !btn) return;

    const position = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const rect = btn.getBoundingClientRect();
      popover.style.setProperty("--_popover-top", `${rect.bottom + 4}px`);
      popover.style.setProperty(
        "--_popover-right",
        `${window.innerWidth - rect.right}px`,
      );
    };

    popover.addEventListener("toggle", position);
    return () => popover.removeEventListener("toggle", position);
  }, []);

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

  const openProfile = () => {
    popoverRef.current?.hidePopover();
    setShowProfile(true);
  };

  return (
    <div className="merch-page">
      <header className="merch-topbar surface-primary ">
        <div
          className="wrapper grid gap-1 padding-i-default padding-b-2"
          style={
            { "--default-max-inline-size": "140ch" } as React.CSSProperties
          }
        >
          <div className="row jc-sb gap-1">
            <div className="merch-brand">
              <div className="merch-brand__meta grid gap-quarter">
                <p className="merch-brand__eyebrow">CHR Merch</p>
                <h1 className="merch-brand__title">Merch Hub</h1>
              </div>
            </div>
            <button
              ref={btnRef}
              className="btn-user-avatar"
              popoverTarget="popover-user-menu"
            >
              {user?.picture && !imgError ? (
                <img
                  src={user.picture}
                  alt=""
                  onError={() => setImgError(true)}
                />
              ) : (
                <span className="bold clr-inverse">{userInitials}</span>
              )}
            </button>
            <div
              ref={popoverRef}
              className="popover-user-menu"
              id="popover-user-menu"
              popover={""}
            >
              <menu className="user-menu">
                <li>
                  <button
                    type="button"
                    className="row ai-cen gap-quarter"
                    onClick={openProfile}
                  >
                    <User aria-hidden="true" />
                    <span>Profile</span>
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="row ai-cen gap-quarter"
                    onClick={handleLogout}
                    aria-label="Logout"
                    title="Logout"
                  >
                    <LogOut aria-hidden="true" />
                    <span>Logout</span>
                  </button>
                </li>
              </menu>
            </div>
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

      <main className="merch-stage wrapper grid gap-1 margin-b-1">
        <section className="merch-hero card">
          <div className="col jc-sb gap-1">
            <div>
              {routeEyebrow && (
                <p className="merch-hero__eyebrow">{routeEyebrow}</p>
              )}
              <h2 className="merch-hero__title">{routeTitle}</h2>
              {routeKicker ? (
                <p className="merch-hero__kicker">{routeKicker}</p>
              ) : null}
            </div>
            {user && (
              <div className="merch-hero__user">
                <p className="badge">
                  {user.canEdit ? "Editor Access" : "View Access"}
                </p>
                <p className="small clr-muted">
                  {user.email ?? "Authorized user"}
                </p>
              </div>
            )}
          </div>
        </section>
        {children && <div className="merch-content">{children}</div>}
      </main>

      {showProfile && user && (
        <DialogUserProfile onClose={() => setShowProfile(false)} />
      )}
    </div>
  );
}

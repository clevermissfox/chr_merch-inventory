import { useState, useEffect } from "react";
import BtnGoogleLogin from "./BtnGoogleLogin";
import type { AuthStatus, AuthUser } from "~/types/user";

function LandingPage() {
  return (
    <>
      <div className="public-page grid">
        <header className="public-header surface-primary padding-b-1 padding-i-default border-block-end">
          <div
            className="wrapper row gap-1 fw-wrap jc-sb ai-cen"
            style={
              { "--default-max-inline-size": "140ch" } as React.CSSProperties
            }
          >
            <div className="merch-brand">
              <div className="merch-brand__meta">
                <p className="merch-brand__eyebrow">CHR Merch</p>
                <h1 className="merch-brand__title">Merch Hub</h1>
              </div>
            </div>
            <BtnGoogleLogin />
          </div>
        </header>

        <main className="wrapper margin-b-2 as-cen container">
          <section className="public-hero card padding-2">
            <p className="merch-hero__eyebrow">Cochise Harm Reduction</p>
            <h2 className="merch-hero__title">
              Merchandise Inventory Management
            </h2>
            <p className="merch-hero__kicker">
              A tool for CHR staff, board, and volunteers to track, manage, and
              sync merchandise stock between our warehouse inventory and the CHR
              online store.
            </p>
          </section>

          <div className="row fw-wrap gap-1 margin-b-1">
            <div className="card public-feature">
              <h3 className="public-feature__title">Live Inventory Tracking</h3>
              <p className="public-feature__body clr-muted">
                View current stock levels for all CHR merchandise products and
                variants in one place, sourced directly from our inventory
                spreadsheet.
              </p>
            </div>
            <div className="card public-feature">
              <h3 className="public-feature__title">WooCommerce Sync</h3>
              <p className="public-feature__body">
                Compare warehouse stock against what's listed on the CHR online
                store and push updates to keep the website accurate and in sync.
              </p>
            </div>
            <div className="card public-feature">
              <h3 className="public-feature__title">Conflict Resolution</h3>
              <p className="public-feature__body">
                Quickly identify products where warehouse and website stock
                counts differ, and selectively push the correct quantities to
                the store.
              </p>
            </div>
          </div>

          <section className="card public-signin row fw-wrap gap-1half ai-cen jc-sb">
            <div className="public-signin__content grid gap-half">
              <h2 className="public-signin__title">Staff Access</h2>
              <p className="public-signin__body clr-muted">
                This tool is restricted to authorized CHR staff and volunteers.
                Sign in with your Google account to access the dashboard. Access
                is granted based on your permissions on the CHR Merch Products
                Spreadsheet.
              </p>
              <p className="xsmall clr-muted">
                Need access? Contact your CHR admin to be added to the CHR Merch
                Products Spreadsheet.
              </p>
            </div>
            <div className="public-signin__action">
              <BtnGoogleLogin />
            </div>
          </section>
        </main>
        <footer className="public-footer card">
          <p
            className="clr-muted wrapper row ai-cen gap-half"
            style={
              { "--default-max-inline-size": "140ch" } as React.CSSProperties
            }
          >
            |
            <span className="xsmall">
              &copy;{new Date().getFullYear()} Cochise Harm Reduction.
              Authorized use only.
            </span>
          </p>
        </footer>
      </div>
    </>
  );
}

export default function AuthCheck({
  children,
  requireAuth = true,
}: {
  children: (user: AuthUser | null) => React.ReactNode;
  requireAuth?: boolean;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data: AuthStatus) => {
        if (data.success) {
          setUser(data.user);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to check auth:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="public-page grid">
        <div className="card wrapper padding-i-default margin-bs-2">
          <p className="status-line" role="status" data-tone="loading">
            Loading…
          </p>
        </div>
      </div>
    );
  }

  if (requireAuth && !user) {
    return <LandingPage />;
  }

  if (user && user.role === "none") {
    return (
      <div className="public-page">
        <header className="public-header surface-primary padding-b-1 padding-i-default border-block-end">
          <div
            className="wrapper row gap-1 fw-wrap jc-sb ai-cen"
            style={
              { "--default-max-inline-size": "140ch" } as React.CSSProperties
            }
          >
            <div className="merch-brand">
              <div className="merch-brand__meta">
                <p className="merch-brand__eyebrow">CHR Merch</p>
                <h1 className="merch-brand__title">Merch Hub</h1>
              </div>
            </div>
          </div>
        </header>
        <main className="wrapper grid gap-1 padding-i-default margin-bs-2">
          <section className="card">
            <h2>Access not granted</h2>
            <p>
              Your Google account doesn't have permission to access this
              dashboard. Contact your CHR admin and ask to be added to the CHR
              Merch Products Spreadsheet.
            </p>
          </section>
        </main>
      </div>
    );
  }

  return <>{children(user)}</>;
}

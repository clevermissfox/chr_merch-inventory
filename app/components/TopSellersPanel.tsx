import { useEffect, useState } from "react";
import { useCatalog } from "~/context/CatalogContext";

interface SellerEntry {
  sku: string;
  displayName: string;
  unitsSold: number;
}

function SellerBar({
  entry,
  maxUnits,
  tone,
}: {
  entry: SellerEntry;
  maxUnits: number;
  tone: "accent" | "warning";
}) {
  // <meter> — the semantically correct element for "a measurement within a
  // known range." Needs -webkit-appearance: none (not just unprefixed
  // appearance) or Chrome keeps native-painting the internal value bar
  // regardless of what author CSS says (see components.css). Real
  // limitation still open: a true 0 renders as a 0px-wide fill no CSS can
  // widen, since <meter>'s box is sized strictly from value/max internally.
  const meterId = `seller-bar-${entry.sku}`;
  return (
    <li className="seller-bar-row">
      <label
        htmlFor={meterId}
        className="seller-bar-name small"
        title={entry.displayName}
      >
        {entry.displayName}
      </label>
      <meter
        id={meterId}
        className={`seller-bar-track seller-bar-track--${tone}`}
        min={0}
        max={maxUnits}
        value={entry.unitsSold}
      />
      <span className="seller-bar-value xsmall clr-muted">
        {entry.unitsSold} sold
      </span>
    </li>
  );
}

export default function TopSellersPanel() {
  const { state } = useCatalog();
  const wooSiteUrl = state.catalog?.summary.wooSiteUrl;
  const [topSellers, setTopSellers] = useState<SellerEntry[] | null>(null);
  const [bottomSellers, setBottomSellers] = useState<SellerEntry[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/catalog/top_sellers?limit=2", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok)
          throw new Error(data.error || "Failed to load top sellers");
        setTopSellers(data.topSellers);
        setBottomSellers(data.bottomSellers);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Failed to load top sellers",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = topSellers && bottomSellers;
  const maxUnits = loaded
    ? Math.max(1, ...topSellers.map((s) => s.unitsSold))
    : 1;

  return (
    <section className="card grid gap-1">
      <hgroup>
        <h2>Top &amp; bottom sellers</h2>
        <p className="small clr-muted">
          Lifetime units sold from{" "}
          {wooSiteUrl ? (
            <a
              href={`${wooSiteUrl}/shop`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              merch shop
            </a>
          ) : (
            <span className="underline">merch shop</span>
          )}
          .
        </p>
      </hgroup>
      {error && (
        <p role="alert" className="status-line" data-tone="error">
          {error}
        </p>
      )}
      {!error && !loaded && (
        <p role="status" className="status-line" data-tone="loading">
          Loading sales data…
        </p>
      )}
      {loaded && topSellers.length === 0 && (
        <p className="small clr-muted">
          No published products with sales data yet.
        </p>
      )}
      {loaded && topSellers.length > 0 && (
        <div className="dashboard-panels">
          <div className="grid gap-half">
            <h3 className="fs-400">Top sellers</h3>
            <ul className="grid gap-half" role="list">
              {topSellers.map((entry) => (
                <SellerBar
                  key={entry.sku}
                  entry={entry}
                  maxUnits={maxUnits}
                  tone="accent"
                />
              ))}
            </ul>
          </div>
          {bottomSellers.length > 0 && (
            <div className="grid gap-half">
              <h3 className="fs-400">Slow movers</h3>
              <ul className="grid gap-half" role="list">
                {bottomSellers.map((entry) => (
                  <SellerBar
                    key={entry.sku}
                    entry={entry}
                    maxUnits={maxUnits}
                    tone="warning"
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

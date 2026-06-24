import { useEffect, useState } from "react";
import type { Route } from "./+types/merch._index";
import SearchComponent from "~/components/SearchComponent";
import type { SearchResult } from "~/components/SearchComponent";
import { useCatalog } from "~/context/CatalogContext";
import type { CatalogGroup, CatalogRow } from "~/types/catalog";
import { Save } from "lucide-react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch Hub | Dashboard" },
    { name: "description", content: "Merch and shop operations dashboard." },
  ];
}

export const handle = {
  title: "Dashboard",
  eyebrow: "Manage shop",
};

interface QuickUpdateTarget {
  sku: string;
  label: string;
  currentStock: number | null;
  group: CatalogGroup;
  row: CatalogRow | null;
}

function resultToTarget(result: SearchResult): QuickUpdateTarget {
  if (result.kind === "row") {
    return {
      sku: result.row.sku,
      label: result.row.label,
      currentStock: result.row.stockQty,
      group: result.group,
      row: result.row,
    };
  }
  return {
    sku: result.group.sku,
    label: result.group.displayName,
    currentStock: result.group.stockQty,
    group: result.group,
    row: null,
  };
}

export default function MerchDashboard() {
  const { state, loadCatalog, setStockQty, syncSelectedSkus } = useCatalog();
  const groups = state.catalog?.groups ?? [];

  useEffect(() => {
    if (!state.catalog && !state.loading) void loadCatalog();
  }, []);

  const [target, setTarget] = useState<QuickUpdateTarget | null>(null);
  const [inputVal, setInputVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedSku, setSavedSku] = useState<string | null>(null);
  const [savedSheetOnly, setSavedSheetOnly] = useState(false);
  const [savedSkipReason, setSavedSkipReason] = useState<string | null>(null);

  const handleSelect = (result: SearchResult) => {
    const t = resultToTarget(result);
    setTarget(t);
    setInputVal(t.currentStock != null ? String(t.currentStock) : "");
    setSaveError(null);
    setSavedSku(null);
    setSavedSheetOnly(false);
    setSavedSkipReason(null);
  };

  const handleSave = async () => {
    if (!target) return;
    const qty = inputVal === "" ? 0 : Number(inputVal);
    if (isNaN(qty) || qty < 0) return;

    setSaving(true);
    setSaveError(null);
    try {
      setStockQty(target.sku, qty, target.currentStock);
      const result = await syncSelectedSkus([target.sku]);
      const skippedEntry = result.skipped.find((s) => s.sku === target.sku);
      setSavedSku(target.sku);
      setSavedSheetOnly(!!skippedEntry);
      setSavedSkipReason(skippedEntry?.reason ?? null);
      setTarget(null);
      setInputVal("");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDismiss = () => {
    setTarget(null);
    setInputVal("");
    setSaveError(null);
    setSavedSheetOnly(false);
    setSavedSkipReason(null);
  };

  return (
    <>
      <section className="card grid gap-1">
        <div>
          <h2>Quick Inventory Update</h2>
          <p className="small clr-muted">
            Search for a SKU or product to update its warehouse stock.
          </p>
        </div>

        {state.loading && !state.catalog && (
          <p role="status" className="status-line" data-tone="loading">
            Loading catalog…
          </p>
        )}

        {state.catalog && (
          <SearchComponent
            groups={groups}
            label="Find a SKU or product"
            placeholder="e.g. black small, CLO, CHR-TEE-0001"
            onSelect={handleSelect}
            renderResult={(result) => {
              if (result.kind === "row") {
                return (
                  <span className="search-result-row">
                    <span className="search-result-row__context">
                      {result.group.displayName}
                    </span>
                    <span className="search-result-row__sku">
                      {result.row.sku}
                    </span>
                    <span className="search-result-row__label clr-muted">
                      {result.row.variantDetails || result.row.label}
                    </span>
                  </span>
                );
              }
              return (
                <span className="search-result-row">
                  {result.group.subcategory && (
                    <span className="search-result-row__context">
                      {result.group.subcategory}
                    </span>
                  )}
                  <span className="search-result-row__sku">
                    {result.group.sku}
                  </span>
                  <span className="search-result-row__label clr-muted">
                    {result.group.displayName}
                  </span>
                </span>
              );
            }}
          />
        )}

        {target && (
          <div className="quick-update card surface-secondary grid gap-1">
            <div className="row jc-sb ai-start">
              <div className="grid gap-quarter">
                <p className="row ai-cen gap-half fw-wrap">
                  <span className="bold">{target.label}</span>
                  {target.group.subcategory && (
                    <span
                      className="search-result-row__context"
                      style={
                        {
                          "--_clr-badge": "var(--clr-accent)",
                        } as React.CSSProperties
                      }
                    >
                      {target.group.subcategory}
                    </span>
                  )}
                </p>
                <p className="xsmall clr-muted">{target.sku}</p>
              </div>
              <button
                type="button"
                className="btn-ghost xsmall"
                onClick={handleDismiss}
                disabled={saving}
              >
                Dismiss
              </button>
            </div>
            <form className="grid gap-half">
              <div className="form-group">
                <label htmlFor="quick-update-qty">
                  Warehouse stock
                  {target.currentStock != null && (
                    <span className="clr-muted xsmall">
                      {" "}
                      — currently {target.currentStock}
                    </span>
                  )}
                </label>
                <input
                  id="quick-update-qty"
                  type="number"
                  min="0"
                  step="1"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSave();
                    if (e.key === "-" || e.key === "e") e.preventDefault();
                  }}
                  disabled={saving}
                  autoFocus
                />
              </div>
              {saveError && (
                <p role="alert" className="status-line" data-tone="error">
                  {saveError}
                </p>
              )}
              <div className="row gap-half">
                <button
                  type="button"
                  className="btn-primary row gap-half ai-cen jc-cen"
                  onClick={handleSave}
                  disabled={saving || inputVal === ""}
                >
                  {saving ? (
                    <>
                      <span className="loader" aria-hidden="true" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Save aria-hidden="true" />
                      <span>Save</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDismiss}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {savedSku && !savedSheetOnly && (
          <p role="status" className="status-line" data-tone="success">
            Stock updated for {savedSku}
          </p>
        )}

        {savedSku && savedSheetOnly && (
          <div role="status" className="grid gap-quarter">
            <p className="status-line" data-tone="warning">
              Stock saved to sheet for {savedSku} — not synced to site
            </p>
            <p className="xsmall clr-muted">
              {savedSkipReason?.toLowerCase().includes("missing woo parent")
                ? "This product hasn't been published to WooCommerce yet — stock is recorded in the sheet and will sync automatically once the product is on the site."
                : (savedSkipReason ?? "Woo sync was skipped.")}
            </p>
          </div>
        )}
      </section>
    </>
  );
}

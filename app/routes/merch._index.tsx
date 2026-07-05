import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/merch._index";
import SearchComponent from "~/components/SearchComponent";
import type { SearchResult } from "~/components/SearchComponent";
import { useCatalog } from "~/context/CatalogContext";
import { useAuth } from "~/context/AuthContext";
import type { CatalogGroup, CatalogPayload, CatalogRow } from "~/types/catalog";
import { Save } from "lucide-react";
import { formatSkipReason } from "~/utils/skipReason";

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

// Same badge rule as the Products page card: no wooId (or no lastHash yet,
// meaning it's never actually been pushed) reads as "Never published";
// otherwise the sheet's own publishedStatus decides Draft vs Published.
// This is a sheet-state summary for an at-a-glance dashboard count, not a
// Woo ground-truth check — Products page's per-card sync flow is what does
// the real ground-truth fetch when it matters for an action.
function classifyGroup(group: CatalogGroup): "never" | "draft" | "published" {
  if (!group.wooId || !group.lastHash) return "never";
  return group.publishedStatus === "draft" ? "draft" : "published";
}

interface AttentionItem {
  productId: string;
  displayName: string;
  sku: string;
  reasons: string[];
}

// Two independent lists, not one merged/prioritized list — a product with
// both a content and a stock issue legitimately belongs in both, and
// silently picking "the" more important one would just hide the other.
// Content issues are fixed on the Products page (editing/publishing);
// stock issues are fixed on the Inventory page (pushing stock numbers),
// so each list links to wherever its fix actually happens.
interface AttentionLists {
  content: AttentionItem[];
  stock: AttentionItem[];
}

function buildAttentionLists(catalog: CatalogPayload): AttentionLists {
  const contentByProductId = new Map<string, AttentionItem>();
  const stockByProductId = new Map<string, AttentionItem>();

  const addReason = (
    map: Map<string, AttentionItem>,
    group: CatalogGroup,
    reason: string,
  ) => {
    const existing = map.get(group.productId);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    } else {
      map.set(group.productId, {
        productId: group.productId,
        displayName: group.displayName,
        sku: group.sku,
        reasons: [reason],
      });
    }
  };

  for (const group of catalog.groups) {
    if (group.contentUnsynced) {
      addReason(contentByProductId, group, "content changed since last sync");
    }

    // Image presence isn't something the catalog payload can answer — the
    // sheet's primary_image field doesn't track what's actually attached in
    // Woo (see WooImageGallery, which fetches that separately). Don't check
    // it here; a real "missing image" check needs its own Woo call, not a
    // catalog-only heuristic.

    const isSimple = group.rowCount === 0;
    const isOutOfStock = isSimple
      ? group.wooId != null && Number(group.wooStock ?? -1) === 0
      : group.rows.some(
          (r) => group.wooId != null && Number(r.wooStock ?? -1) === 0,
        );
    if (isOutOfStock) addReason(stockByProductId, group, "out of stock on site");
  }

  for (const conflict of catalog.summary.conflictGroups) {
    const group = catalog.groups.find((g) => g.productId === conflict.productId);
    if (group) {
      addReason(
        stockByProductId,
        group,
        `${conflict.count} stock conflict${conflict.count !== 1 ? "s" : ""}`,
      );
    }
  }

  return {
    content: Array.from(contentByProductId.values()),
    stock: Array.from(stockByProductId.values()),
  };
}

function AttentionPanel({
  title,
  description,
  items,
  linkTo,
  linkLabel,
}: {
  title: string;
  description: string;
  items: AttentionItem[];
  linkTo: (item: AttentionItem) => string;
  linkLabel: string;
}) {
  const shown = items.slice(0, 6);
  if (items.length === 0) return null;
  return (
    <div className="grid gap-1">
      <hgroup>
        <h3 className="fs-400">{title}</h3>
        <p className="xsmall clr-muted">{description}</p>
      </hgroup>
      <ul className="grid gap-half" role="list">
        {shown.map((item) => (
          <li
            key={item.productId}
            className="row jc-sb ai-cen gap-1 fw-wrap padding-half surface-secondary"
          >
            <div className="grid gap-quarter">
              <p className="row gap-half ai-cen fw-wrap">
                <span className="bold">{item.displayName}</span>
                <span className="xsmall clr-muted">{item.sku}</span>
              </p>
              <p className="xsmall clr-warning">{item.reasons.join(" · ")}</p>
            </div>
            <Link to={linkTo(item)} className="xsmall">
              {linkLabel}
            </Link>
          </li>
        ))}
      </ul>
      {items.length > shown.length && (
        <p className="xsmall clr-muted">
          +{items.length - shown.length} more
        </p>
      )}
    </div>
  );
}

export default function MerchDashboard() {
  const { user } = useAuth();
  const canEdit = user?.canEdit === true;
  const { state, loadCatalog, syncSelectedSkus } = useCatalog();
  const groups = state.catalog?.groups ?? [];

  useEffect(() => {
    if (!state.catalog && !state.loading) void loadCatalog();
  }, []);

  const catalog = state.catalog;
  const publishedCount = groups.filter((g) => classifyGroup(g) === "published").length;
  const draftCount = groups.filter((g) => classifyGroup(g) === "draft").length;
  const neverPublishedCount = groups.filter((g) => classifyGroup(g) === "never").length;
  const attentionLists = catalog
    ? buildAttentionLists(catalog)
    : { content: [], stock: [] };

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
      const overrideDirty = {
        [target.sku]: {
          sku: target.sku,
          stockQty: qty,
          originalStockQty: target.currentStock ?? null,
        },
      };
      const result = await syncSelectedSkus([target.sku], overrideDirty);
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

  // A single gate for the whole dashboard body — the pieces below aren't
  // independently useful without the catalog, so show one loading state and
  // then swap in the finished layout all at once, instead of letting each
  // section pop in separately as its own data becomes ready (which visibly
  // shoves the search box below it down the page mid-load).
  if (!catalog) {
    return (
      <section className="card">
        <p role="status" className="status-line" data-tone="loading">
          {state.error ?? "Loading dashboard…"}
        </p>
      </section>
    );
  }

  const hasAttention =
    attentionLists.content.length > 0 || attentionLists.stock.length > 0;

  return (
    <>
      <section className="hero card">
        <div className="hero-grid">
          <div className="metric">
            <p className="metric-label">Products</p>
            <p className="metric-value">{catalog.summary.productCount}</p>
          </div>
          <div className="metric">
            <p className="metric-label">Variants</p>
            <p className="metric-value">{catalog.summary.rowCount}</p>
          </div>
          <div className="metric">
            <p className="metric-label">Published</p>
            <p className="metric-value">{publishedCount}</p>
          </div>
          <div className="metric">
            <p className="metric-label">Draft (was live)</p>
            <p className="metric-value">{draftCount}</p>
          </div>
          <div className="metric">
            <p className="metric-label">Never published</p>
            <p className="metric-value">{neverPublishedCount}</p>
          </div>
          <div className="metric">
            <p className="metric-label">Content unsynced</p>
            <p
              className={`metric-value${catalog.summary.contentUnsyncedCount > 0 ? " clr-warning" : ""}`}
            >
              {catalog.summary.contentUnsyncedCount}
            </p>
          </div>
        </div>
      </section>

      <section className="card grid gap-1">
        <hgroup>
          <h2>Quick Inventory Update</h2>
          <p className="small clr-muted">
            Search for a SKU or product to update its warehouse stock.
          </p>
        </hgroup>

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
                <label htmlFor="quick-update-qty" className="bold">
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
                  disabled={saving || !canEdit}
                  autoFocus
                />
              </div>
              {saveError && (
                <p role="alert" className="status-line" data-tone="error">
                  {saveError}
                </p>
              )}
              {canEdit && (
                <div className="row gap-half">
                  <button
                    type="button"
                    className="btn-primary row gap-half ai-cen jc-cen"
                    onClick={handleSave}
                    disabled={saving || inputVal === ""}
                  >
                    {saving ? (
                      <>
                        <span className="render-loader">Saving…</span>
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
              )}
            </form>
          </div>
        )}

        {savedSku && !savedSheetOnly && (
          <p role="status" className="status-line" data-tone="success">
            Stock updated for {savedSku}
          </p>
        )}

        {savedSku &&
          savedSheetOnly &&
          (() => {
            const { label, hint } = formatSkipReason(savedSkipReason ?? "");
            return (
              <div role="status" className="grid gap-quarter">
                <p className="status-line" data-tone="warning">
                  Stock saved to sheet for {savedSku} — {label}
                </p>
                {hint && <p className="xsmall clr-muted">{hint}</p>}
              </div>
            );
          })()}
      </section>

      <section className="card grid gap-1">
        <hgroup>
          <h2>Needs attention</h2>
          <p className="small clr-muted">
            Split by where the fix actually happens — a product can appear in
            both if it has both kinds of issue.
          </p>
        </hgroup>
        {hasAttention ? (
          <div className="dashboard-panels">
            <AttentionPanel
              title="Content / publish"
              description="Fixed on the Products page."
              items={attentionLists.content}
              linkTo={(item) =>
                `/products?highlight=${encodeURIComponent(item.productId)}`
              }
              linkLabel="Review →"
            />
            <AttentionPanel
              title="Stock"
              description="Fixed on the Inventory page."
              items={attentionLists.stock}
              linkTo={(item) =>
                `/inventory?highlight=${encodeURIComponent(item.productId)}`
              }
              linkLabel="Resolve →"
            />
          </div>
        ) : (
          <p className="small clr-muted">Nothing needs attention right now.</p>
        )}
      </section>
    </>
  );
}

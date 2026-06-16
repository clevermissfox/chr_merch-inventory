import { useEffect } from "react";
import type { Route } from "./+types/merch.inventory";
import { useCatalog } from "../context/CatalogContext";
import { useAuth } from "~/context/AuthContext";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch | Inventory" },
    {
      name: "description",
      content:
        "Inventory management workspace for warehouse and website stock.",
    },
    { property: "og:title", content: "CHR Merch Inventory Dashboard" },
    {
      property: "og:description",
      content: "Manage warehouse and website stock.",
    },
    { property: "og:image", content: "https://cochiseharmreduction.org" },
    { property: "og:type", content: "website" },

    // X / Twitter Card tags
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: "CHR Merch Inventory Dashboard" },
    { name: "twitter:image", content: "https://cochiseharmreduction.org" },
  ];
}

export const handle = {
  title: "Inventory Solution",
  eyebrow: "Manage stock",
};

export default function InventoryPage() {
  const { user, isLoading } = useAuth();
  const canEdit = user?.canEdit === true;
  const {
    state,
    loadCatalog,
    setStockQty,
    saveCatalogChanges,
    resolveCatalogConflicts,
  } = useCatalog();
  const hasDirtyChanges = Object.keys(state.dirtyBySku).length > 0;
  const dirtyChangeCount = Object.keys(state.dirtyBySku).length;

  useEffect(() => {
    if (!state.catalog && !state.loading) {
      void loadCatalog();
    }
  }, [state.catalog, state.loading, loadCatalog]);

  if (state.loading && !state.catalog) {
    return (
      <section className="card">
        <div className="status-line">
          Loading inventory…<span className="loader"></span>
        </div>
      </section>
    );
  }

  if (!state.catalog) {
    return (
      <section className="card">
        <div className="status-line">No inventory data available.</div>
      </section>
    );
  }

  const { catalog } = state;
  let statusMessage = "";
  let showLoader = false;

  if (state.loading) {
    statusMessage = "Refreshing website stock…";
    showLoader = true;
  } else if (state.saving) {
    statusMessage = "Saving stock changes...";
    showLoader = true;
  } else if (state.error) {
    statusMessage = `Error: ${state.error}`;
  } else if (hasDirtyChanges) {
    statusMessage = `${dirtyChangeCount} unsaved stock change${dirtyChangeCount > 1 ? "s" : ""}`;
  } else {
    statusMessage = `Loaded ${catalog.summary.rowCount} inventory rows across ${catalog.summary.productCount} products.`;
  }

  const metrics = [
    { label: "Products", value: catalog.summary.productCount },
    { label: "Inventory Rows", value: catalog.summary.rowCount },
    {
      label: "Stock Conflicts",
      value: catalog.summary.conflictGroups.length,
      renderExtra: () =>
        catalog.summary.conflictGroups.length > 0 && (
          <>
            <ul
              className="conflict-list xsmall margin-bs-1 row fw-wrap gap-half  "
              role="list"
            >
              {catalog.summary.conflictGroups.map((c) => (
                <li key={c.productId} className="conflict-chip">
                  {c.displayName} ({c.count})
                </li>
              ))}
            </ul>
            <button onClick={resolveCatalogConflicts}>Resolve Conflicts</button>
          </>
        ),
    },
  ];

  return (
    <>
      <section className="hero card">
        <div className="hero-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="metric">
              <div className="metric-label">{metric.label}</div>
              <div className="metric-value">{metric.value}</div>
              {metric.renderExtra?.()}
            </div>
          ))}
        </div>
      </section>

      <section className="toolbar card">
        <div className="toolbar-row">
          <div>
            <div className="badge">
              {canEdit ? "Editor Access" : "View Access"}
            </div>
            <div className="small">
              {user?.email ?? "Authorized user"}
              {user?.role ? ` (${user.role})` : ""}
            </div>
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void loadCatalog(true)}
              disabled={state.loading || state.saving}
            >
              {state.loading ? "Refreshing..." : "Refresh Website Stock"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                !hasDirtyChanges || !canEdit || state.loading || state.saving
              }
              onClick={() => void saveCatalogChanges()}
            >
              {state.saving ? "Syncing Stock..." : "Push Warehouse Stock Live"}
            </button>
          </div>
        </div>

        <div className="toolbar-row">
          <div className="status-line">
            <div
              className="status-line"
              role={state.error ? "alert" : "status"}
            >
              <span>{statusMessage}</span>
              {showLoader && <span className="loader" />}
            </div>
          </div>
        </div>
      </section>

      <section className="inventory-groups">
        {catalog.groups.map((group, i) => (
          <details
            key={group.productId}
            className="inventory-group card"
            open={i === 0}
          >
            <summary>
              <div className="summary-title">
                <strong>{group.displayName}</strong>
                <span className="summary-count">
                  {group.rowCount} SKU{group.rowCount === 1 ? "" : "s"}
                </span>
              </div>
              <span className="toggle-label">Toggle</span>
            </summary>

            <div className="table-wrapper">
              <table className="inventory-table">
                <colgroup>
                  <col style={{ width: "fit-content" }} />
                  <col style={{ width: "100%" }} />
                  <col style={{ width: "fit-content" }} />
                  <col style={{ width: "fit-content" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Item</th>
                    <th>Warehouse Stock</th>
                    <th>Website Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => {
                    const dirtyChange = state.dirtyBySku[row.sku];
                    const isDirty = dirtyChange !== undefined;
                    const dirtyValue = dirtyChange?.stockQty;
                    const displayStockQty =
                      dirtyValue !== undefined ? dirtyValue : row.stockQty;

                    const normalizedDisplayStockQty =
                      displayStockQty === "" || displayStockQty == null
                        ? null
                        : Number(displayStockQty);

                    const normalizedWooStock =
                      row.wooStock == null ? null : Number(row.wooStock);

                    const mismatch =
                      normalizedDisplayStockQty !== normalizedWooStock;

                    return (
                      <tr
                        key={row.sku}
                        data-sku={row.sku}
                        data-dirty={isDirty ? "true" : undefined}
                        className={
                          mismatch
                            ? "merch-status merch-status--mismatch"
                            : "merch-status merch-status--ok"
                        }
                      >
                        <td className="sku-cell">{row.sku}</td>
                        <td className="variant-cell">{row.label}</td>
                        <td>
                          {canEdit ? (
                            <input
                              type="number"
                              name={`stock-${row.sku}`}
                              aria-label={`Stock quantity for ${row.label} (SKU: ${row.sku})`}
                              className="stock-input ta-cen"
                              value={displayStockQty ?? ""}
                              onChange={(event) => {
                                const nextValue = event.target.value
                                  ? event.target.value
                                  : row.stockQty;
                                setStockQty(
                                  row.sku,
                                  nextValue === "" ? "" : Number(nextValue),
                                  row.stockQty ?? null,
                                );
                              }}
                            />
                          ) : (
                            <span className="ta-cen display-block">
                              {row.stockQty ?? ""}
                            </span>
                          )}
                        </td>
                        <td data-mismatch={mismatch} className="ta-cen">
                          <input
                            type="number"
                            name={`woo-${row.sku}`}
                            aria-label={`Website stock quantity for ${row.label} (SKU: ${row.sku})`}
                            className="stock-input ta-cen"
                            value={row.wooStock ?? ""}
                            disabled
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </section>
    </>
  );
}

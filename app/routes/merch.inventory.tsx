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
  ];
}

export default function InventoryPage() {
  const { user, isLoading } = useAuth();
  const canEdit = user?.canEdit === true;
  const { state, loadCatalog, setStockQty } = useCatalog();
  const hasDirtyChanges = Object.keys(state.dirtyBySku).length > 0;

  useEffect(() => {
    if (!state.catalog && !state.loading) {
      void loadCatalog();
    }
  }, [state.catalog, state.loading, loadCatalog]);

  if (state.loading && !state.catalog) {
    return (
      <section className="card">
        <div className="status-line">Loading inventory…</div>
      </section>
    );
  }

  if (state.error) {
    return (
      <section className="card">
        <div className="status-line">Error: {state.error}</div>
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
  const metrics = [
    { label: "Products", value: catalog.summary.productCount },
    { label: "Inventory Rows", value: catalog.summary.rowCount },
    { label: "Stock Conflicts", value: catalog.summary.conflictGroups.length },
  ];

  return (
    <>
      <section className="hero card">
        <div className="hero-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="metric">
              <div className="metric-label">{metric.label}</div>
              <div className="metric-value">{metric.value}</div>
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
              disabled={state.loading}
            >
              {state.loading ? "Refreshing..." : "Refresh Website Stock"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!hasDirtyChanges || !canEdit}
            >
              Push Warehouse Stock Live
            </button>
          </div>
        </div>

        <div className="toolbar-row">
          <div className="status-line">
            {state.loading
              ? "Refreshing website stock…"
              : `Loaded ${catalog.summary.rowCount} inventory rows across ${catalog.summary.productCount} products.`}
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
                    const dirtyValue = state.dirtyBySku[row.sku]?.stockQty;
                    const displayStockQty =
                      dirtyValue !== undefined ? dirtyValue : row.stockQty;

                    const mismatch = row.stockQty !== row.wooStock;

                    return (
                      <tr
                        key={row.sku}
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
                            <span className="ta-cen">{row.stockQty ?? ""}</span>
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

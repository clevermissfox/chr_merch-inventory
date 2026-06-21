import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/merch.inventory";
import { useCatalog } from "../context/CatalogContext";
import { useAuth } from "~/context/AuthContext";
import ConfirmSyncDialog from "~/components/ConfirmSyncDialog";
import type { CatalogGroup } from "~/types/catalog";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch Hub | Inventory" },
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
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: "CHR Merch Inventory Dashboard" },
    { name: "twitter:image", content: "https://cochiseharmreduction.org" },
  ];
}

export const handle = {
  title: "Inventory Solution",
  eyebrow: "Manage stock",
};

function GroupCheckbox({
  group,
  checked,
  indeterminate,
  onChange,
}: {
  group: CatalogGroup;
  checked: boolean;
  indeterminate: boolean;
  onChange: (willBeChecked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className="item-selection">
      <input
        ref={ref}
        type="checkbox"
        className="group-checkbox"
        checked={checked}
        aria-label={`Select all SKUs for product ${group.productId}`}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
      />
    </label>
  );
}

export default function InventoryPage() {
  const { user } = useAuth();
  const canEdit = user?.canEdit === true;
  const { state, loadCatalog, setStockQty, syncSelectedSkus } = useCatalog();

  const hasDirtyChanges = Object.keys(state.dirtyBySku).length > 0;
  const dirtyChangeCount = Object.keys(state.dirtyBySku).length;

  const [selectMode, setSelectMode] = useState(false);
  const [selectedMode, setSelectedMode] = useState("");
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

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

  const handleSelectMode = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const mode = e.target.value;
    setSelectedMode(mode);
    setSyncFeedback(null);

    let skus: Set<string>;
    if (mode === "sync_all") {
      skus = new Set(catalog.groups.flatMap((g) => g.rows.map((r) => r.sku)));
    } else if (mode === "resolve_conflicts") {
      skus = new Set(
        catalog.groups.flatMap((g) =>
          g.rows
            .filter((r) => {
              const dirty = state.dirtyBySku[r.sku];
              const displayQty =
                dirty?.stockQty !== undefined ? dirty.stockQty : r.stockQty;
              const ws =
                displayQty === "" || displayQty == null
                  ? null
                  : Number(displayQty);
              const woo = r.wooStock == null ? null : Number(r.wooStock);
              return ws !== woo;
            })
            .map((r) => r.sku),
        ),
      );
    } else {
      skus = new Set(Object.keys(state.dirtyBySku));
    }
    setSelectedSkus(skus);

    setSelectMode(mode === "custom_selection");
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedSkus(new Set());
    setShowConfirm(false);
  };

  const toggleSku = (sku: string, checked: boolean) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      checked ? next.add(sku) : next.delete(sku);
      return next;
    });
  };

  const toggleGroup = (group: CatalogGroup, willBeChecked: boolean) => {
    setSelectedSkus((prev) => {
      const next = new Set(prev);
      for (const row of group.rows) {
        willBeChecked ? next.add(row.sku) : next.delete(row.sku);
      }
      return next;
    });
  };

  const handleConfirmPush = async () => {
    setShowConfirm(false);
    const skusToSync = Array.from(selectedSkus);
    exitSelectMode();
    setSyncFeedback("Pushing selected stock…");
    try {
      const result = await syncSelectedSkus(skusToSync);
      setSyncFeedback(
        `Pushed ${result.updatedCount} SKU${result.updatedCount !== 1 ? "s" : ""} to website.` +
          (result.skippedCount > 0 ? ` ${result.skippedCount} skipped.` : ""),
      );
    } catch {
      setSyncFeedback(null);
    }
  };

  const confirmGroups = catalog.groups
    .map((group) => ({
      displayName: group.displayName,
      skuCount: group.rows.filter((row) => selectedSkus.has(row.sku)).length,
    }))
    .filter((g) => g.skuCount > 0);

  let statusMessage = "";
  let showLoader = false;
  let statusTone: "error" | undefined;

  if (state.loading) {
    statusMessage = "Refreshing website stock…";
    showLoader = true;
  } else if (state.saving) {
    statusMessage = "Syncing stock…";
    showLoader = true;
  } else if (state.error) {
    statusMessage = state.error;
    statusTone = "error";
  } else if (syncFeedback) {
    statusMessage = syncFeedback;
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
          <ul
            className="conflict-list xsmall margin-bs-1 row fw-wrap gap-half"
            role="list"
          >
            {catalog.summary.conflictGroups.map((c) => (
              <li key={c.productId} className="conflict-chip">
                {c.displayName} ({c.count})
              </li>
            ))}
          </ul>
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
            {canEdit && (
              <form className="select-mode-form">
                <select
                  className="select-mode"
                  size={4}
                  value={selectedMode}
                  onChange={handleSelectMode}
                  disabled={state.loading || state.saving}
                >
                  <option value="sync_all">Sync All</option>
                  <option value="standard_sync" disabled={!hasDirtyChanges}>
                    Sync Changes
                  </option>
                  <option
                    value="resolve_conflicts"
                    disabled={catalog.summary.conflictGroups.length === 0}
                  >
                    Resolve Conflicts
                  </option>
                  <option value="custom_selection">Custom Selection</option>
                </select>
                <div className="row gap-1 w-100">
                  <button
                    type="button"
                    className="btn-secondary row gap-half"
                    onClick={() => void loadCatalog()}
                    disabled={state.loading || state.saving}
                  >
                    <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                    {state.loading
                      ? "Refreshing..."
                      : "Refresh Current Website Stock"}
                  </button>

                  <button
                    type="submit"
                    className="btn-primary flex-1"
                    disabled={selectedSkus.size === 0 || state.saving}
                    onClick={(e) => {
                      e.preventDefault();
                      setShowConfirm(true);
                    }}
                  >
                    Push Stock({selectedSkus.size})
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="toolbar-row">
          <div
            className="status-line"
            role={statusTone === "error" ? "alert" : "status"}
            data-tone={statusTone}
          >
            <span>{statusMessage}</span>
            {showLoader && <span className="loader" />}
          </div>
        </div>
      </section>

      <section className="inventory-groups">
        {catalog.groups.map((group, i) => {
          const groupSkus = group.rows.map((r) => r.sku);
          const selectedInGroup = groupSkus.filter((sku) =>
            selectedSkus.has(sku),
          );
          const allSelected =
            groupSkus.length > 0 && selectedInGroup.length === groupSkus.length;
          const someSelected = selectedInGroup.length > 0 && !allSelected;

          return (
            <details
              key={group.productId}
              className="inventory-group card"
              open={i === 0}
            >
              <summary>
                {selectMode && (
                  <GroupCheckbox
                    group={group}
                    checked={allSelected}
                    indeterminate={someSelected}
                    onChange={(willBeChecked) =>
                      toggleGroup(group, willBeChecked)
                    }
                  />
                )}
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
                    {selectMode && <col style={{ width: "fit-content" }} />}
                    <col style={{ width: "fit-content" }} />
                    <col style={{ width: "100%" }} />
                    <col style={{ width: "fit-content" }} />
                    <col style={{ width: "fit-content" }} />
                  </colgroup>
                  <thead>
                    <tr>
                      {selectMode && <th aria-label="Select"></th>}
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

                      const isSelected = selectedSkus.has(row.sku);

                      return (
                        <tr
                          key={row.sku}
                          data-sku={row.sku}
                          data-dirty={isDirty ? "true" : undefined}
                          data-selected={
                            selectMode && isSelected ? "true" : undefined
                          }
                          className={
                            mismatch
                              ? "merch-status merch-status--mismatch"
                              : "merch-status merch-status--ok"
                          }
                        >
                          {selectMode && (
                            <td className="select-cell">
                              <label className="item-selection">
                                <input
                                  type="checkbox"
                                  className="row-checkbox"
                                  checked={isSelected}
                                  aria-label={`Select ${row.label} (SKU: ${row.sku})`}
                                  onChange={(e) =>
                                    toggleSku(row.sku, e.target.checked)
                                  }
                                />
                              </label>
                            </td>
                          )}
                          <td className="sku-cell">{row.sku}</td>
                          <td className="variant-cell">{row.label}</td>
                          <td>
                            {canEdit ? (
                              <input
                                type="number"
                                name={`stock-${row.sku}`}
                                aria-label={`Stock quantity for ${row.label} (SKU: ${row.sku})`}
                                className="stock-input ta-cen"
                                min={0}
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
                                  if (selectMode) toggleSku(row.sku, true);
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
          );
        })}
      </section>

      {showConfirm && (
        <ConfirmSyncDialog
          groups={confirmGroups}
          totalSkus={selectedSkus.size}
          saving={state.saving}
          wooSiteUrl={catalog.summary.wooSiteUrl}
          onConfirm={() => void handleConfirmPush()}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}

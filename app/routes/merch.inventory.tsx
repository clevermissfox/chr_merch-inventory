import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/merch.inventory";
import { useCatalog } from "../context/CatalogContext";
import { useAuth } from "~/context/AuthContext";
import DialogConfirm from "~/components/DialogConfirm";
import type { CatalogGroup } from "~/types/catalog";
import { ArrowDownUp, RefreshCw } from "lucide-react";

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
  const [selectedMode, setSelectedMode] = useState("sync_all");
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [syncSkipped, setSyncSkipped] = useState<
    Array<{ sku: string; reason: string }>
  >([]);

  useEffect(() => {
    if (!state.catalog && !state.loading) {
      void loadCatalog({ withStock: true });
    }
  }, [state.catalog, state.loading, loadCatalog]);

  useEffect(() => {
    if (state.catalog && selectedMode === "sync_all") {
      setSelectedSkus(
        new Set(state.catalog.groups.flatMap((g) => g.rows.map((r) => r.sku))),
      );
    }
  }, [state.catalog]);

  if (state.loading && !state.catalog) {
    return (
      <section className="card">
        <p
          className="status-line row ai-cen gap-half"
          role="status"
          data-tone="loading"
        >
          Loading inventory…
        </p>
      </section>
    );
  }

  if (!state.catalog) {
    return (
      <section className="card">
        <p role="status" className="status-line">
          No inventory data available.
        </p>
      </section>
    );
  }

  const { catalog } = state;

  const handleSelectMode = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const mode = e.target.value;
    setSelectedMode(mode);
    setSyncFeedback(null);
    setSyncSkipped([]);

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
    setSyncSkipped([]);
    try {
      const result = await syncSelectedSkus(skusToSync);
      setSyncFeedback(
        `Pushed ${result.updatedCount} SKU${result.updatedCount !== 1 ? "s" : ""} to website.` +
          (result.skippedCount > 0
            ? ` ${result.skippedCount} not synced to site.`
            : ""),
      );
      setSyncSkipped(result.skipped);
    } catch {
      setSyncFeedback(null);
      setSyncSkipped([]);
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

  function formatSkipReason(reason: string): {
    label: string;
    hint: string | null;
  } {
    if (reason.toLowerCase().includes("missing woo parent product")) {
      return {
        label: "Not yet published to site",
        hint: "Stock is recorded in the sheet and will sync automatically once the product is published to WooCommerce.",
      };
    }
    if (reason === "variable_parent_not_editable") {
      return {
        label: "Variable product parent — update individual variants",
        hint: null,
      };
    }
    if (reason === "not_found") {
      return { label: "SKU not found in catalog", hint: null };
    }
    return { label: reason, hint: null };
  }

  return (
    <>
      <section className="hero card">
        <div className="hero-grid">
          {metrics.map((metric) => (
            <div key={metric.label} className="metric">
              <p className="metric-label">{metric.label}</p>
              <p className="metric-value">{metric.value}</p>
              {metric.renderExtra?.()}
            </div>
          ))}
        </div>
      </section>

      <section className="toolbar grid gap-1 card">
        <div className="toolbar-actions row fw-wrap gap-1 ai-st">
          {canEdit && (
            <form className="form-select-mode">
              <div className="form-group">
                <label className="bold ls-1" htmlFor="select-mode">
                  Select edit mode:
                </label>
                <select
                  className="select-mode"
                  id="select-mode"
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
              </div>
              <div className="form-group row gap-1 fw-wrap w-100">
                <button
                  type="button"
                  className="btn-secondary btn-lg flex-1 row gap-half jc-cen ai-cen"
                  onClick={() => void loadCatalog({ withStock: true })}
                  disabled={state.loading || state.saving}
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={state.loading ? "rotate" : ""}
                  />
                  <span>
                    {state.loading
                      ? "Refreshing..."
                      : "Refresh Current Website Stock"}
                  </span>
                </button>

                <button
                  type="submit"
                  className="btn-primary btn-lg flex-1 row gap-half jc-cen ai-cen"
                  disabled={selectedSkus.size === 0 || state.saving}
                  onClick={(e) => {
                    e.preventDefault();
                    setShowConfirm(true);
                  }}
                >
                  <ArrowDownUp aria-hidden="true" />
                  <span>Push Stock({selectedSkus.size})</span>
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="toolbar-row row gap-1 jc-sb ai-cen fw-wrap">
          <p
            className="status-line"
            role={statusTone === "error" ? "alert" : "status"}
            data-tone={
              statusTone === "error" ? "error" : showLoader ? "loading" : ""
            }
          >
            {statusMessage}
          </p>
        </div>

        {syncSkipped.length > 0 && (
          <div className="grid gap-half">
            <p className="xsmall bold clr-muted">Not synced to site:</p>
            <ul className="grid gap-quarter" role="list">
              {syncSkipped.map(({ sku, reason }) => {
                const { label, hint } = formatSkipReason(reason);
                return (
                  <li
                    key={sku}
                    className="grid gap-025 padding-half surface-secondary"
                  >
                    <span className="xsmall">
                      <strong>{sku}</strong>
                      <span className="clr-muted"> — {label}</span>
                    </span>
                    {hint && <span className="xsmall clr-muted">{hint}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="grid gap-1">
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
              className="toggle-group inventory-group card"
              open={i === 0}
            >
              <summary>
                <div className="row gap-half">
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
                    <p className="summary-count">
                      {group.rowCount} SKU{group.rowCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <span className="toggle-label">Toggle</span>
              </summary>

              <div className="table-wrapper">
                <table className="data-table inventory-table">
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
        <DialogConfirm
          title="Push stock to website"
          confirmLabel={`Push ${selectedSkus.size} SKU${selectedSkus.size !== 1 ? "s" : ""}`}
          confirmingLabel="Pushing…"
          confirmVariant="primary"
          status={state.saving ? "confirming" : "idle"}
          onConfirm={() => void handleConfirmPush()}
          onCancel={() => setShowConfirm(false)}
        >
          <p className="small clr-muted">
            These products will be updated on{" "}
            {catalog.summary.wooSiteUrl ?? "CHR website"}:
          </p>
          <ul className="dialog-confirm-list" role="list">
            {confirmGroups.map((g) => (
              <li key={g.displayName} className="dialog-confirm-item">
                <span>{g.displayName}</span>
                <span className="dialog-confirm-count">
                  {g.skuCount} SKU{g.skuCount !== 1 ? "s" : ""}
                </span>
              </li>
            ))}
          </ul>
        </DialogConfirm>
      )}
    </>
  );
}

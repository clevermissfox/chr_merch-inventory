import { useEffect, useState } from "react";
import type { Route } from "./+types/merch.products";
import { useCatalog } from "~/context/CatalogContext";
import { useAuth } from "~/context/AuthContext";
import DialogCreateProduct from "~/components/DialogCreateProduct";
import DialogConfirm from "~/components/DialogConfirm";
import type { DialogConfirmStatus } from "~/components/DialogConfirm";
import DialogCreateVariant from "~/components/DialogCreateVariant";
import DialogDeleteVariant from "~/components/DialogDeleteVariant";
import DialogEditProduct from "~/components/DialogEditProduct";
import DialogEditVariant from "~/components/DialogEditVariant";
import type { CatalogGroup, CatalogRow } from "~/types/catalog";
import { Globe, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "CHR Merch Hub | Products" },
    {
      name: "description",
      content:
        "Product-level merch management with nested descriptions and variants.",
    },
  ];
}

export const handle = {
  title: "Catalog",
  eyebrow: "Manage products",
};

function truncate(str: string | null | undefined, len: number): string | null {
  if (!str) return null;
  return str.length > len ? str.slice(0, len) + "…" : str;
}

interface ProductGroupProps {
  group: CatalogGroup;
  canEdit: boolean;
  onDeleteRequest: (group: CatalogGroup) => void;
  onAddVariantsRequest: (group: CatalogGroup) => void;
  onDeleteVariantRequest: (row: CatalogRow, group: CatalogGroup) => void;
  onEditVariantRequest: (row: CatalogRow, group: CatalogGroup) => void;
  onPublishRequest: (group: CatalogGroup) => void;
  onEditRequest: (group: CatalogGroup) => void;
}

function ProductGroup({
  group,
  canEdit,
  onDeleteRequest,
  onAddVariantsRequest,
  onDeleteVariantRequest,
  onEditVariantRequest,
  onPublishRequest,
  onEditRequest,
}: ProductGroupProps) {
  const isSimple = group.rowCount === 0;

  return (
    <details className="toggle-group card">
      <summary>
        <div className="summary-title">
          <p className="row gap-half ai-cen fw-wrap">
            <strong>{group.displayName}</strong>
            <span className="summary-count">
              {isSimple
                ? "Simple product"
                : `${group.rowCount} SKU${group.rowCount !== 1 ? "s" : ""}`}
            </span>
            {!group.wooId || !group.lastHash ? (
              <span className="published-status-badge">Unpublished</span>
            ) : group.publishedStatus === "draft" ? (
              <span className="published-status-badge">Draft</span>
            ) : null}
          </p>
        </div>
        <span className="toggle-label">Toggle</span>
      </summary>

      <div className="product-body row fw-wrap gap-1">
        <div className="product-info flex-1 padding-b-three-forths padding-i-1quarter grid gap-1quarter">
          <dl className="product-meta row fw-wrap">
            <div>
              <dt>SKU</dt>
              <dd>{group.sku}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>
                {group.category} · {group.subcategory}
              </dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>{group.basePriceDollars || "—"}</dd>
            </div>
            {group.weightOz && (
              <div>
                <dt>Weight</dt>
                <dd>{group.weightOz}oz</dd>
              </div>
            )}
            {group.design && (
              <div>
                <dt>Design</dt>
                <dd>{group.design}</dd>
              </div>
            )}
            {group.dimensionsWidth && group.dimensionsHeight && (
              <div>
                <dt>Dimensions</dt>
                <dd>{group.dimensionsWidth + "x" + group.dimensionsHeight}</dd>
              </div>
            )}
            <div>
              <dt>Last synced</dt>
              <dd>
                {group.lastSyncedAt
                  ? new Date(group.lastSyncedAt).toLocaleString()
                  : "Never"}
              </dd>
            </div>
          </dl>

          {(group.primaryDescription || group.shortDescription) && (
            <dl className="product-meta product-desc col">
              {group.primaryDescription && (
                <div>
                  <dt>Description</dt>
                  <dd>{truncate(group.primaryDescription, 120)}</dd>
                </div>
              )}
              {group.shortDescription && (
                <div>
                  <dt>Short Description</dt>
                  <dd>{truncate(group.shortDescription, 120)}</dd>
                </div>
              )}
            </dl>
          )}
        </div>

        {canEdit && (
          <div className="product-actions">
            <button
              type="button"
              className="btn-secondary row gap-half ai-cen"
              onClick={() => onPublishRequest(group)}
            >
              <Globe aria-hidden="true" />
              <span>{group.wooId ? "Sync to site" : "Publish to site"}</span>
            </button>
            <button
              type="button"
              className="btn-secondary row gap-half ai-cen"
              onClick={() => onAddVariantsRequest(group)}
            >
              <Plus aria-hidden="true" />
              <span>Add Variants</span>
            </button>
            <button
              type="button"
              className="btn-secondary row gap-half ai-cen"
              onClick={() => onEditRequest(group)}
            >
              <Pencil aria-hidden="true" />
              <span>Edit</span>
            </button>
            <button
              type="button"
              className="btn-primary btn-danger row gap-half ai-cen"
              onClick={() => onDeleteRequest(group)}
            >
              <Trash2 aria-hidden="true" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>

      {!isSimple && (
        <details className="variants-group">
          <summary className="row ai-cen jc-sb gap-1 padding-b-three-forths padding-i-1quarter">
            <span className="small">
              {group.rowCount} variant{group.rowCount !== 1 ? "s" : ""}
            </span>
            <span className="toggle-label small">Toggle</span>
          </summary>

          <div className="table-wrapper">
            <table className="data-table variants-table surface-tertiary">
              <colgroup>
                <col style={{ width: "fit-content" }}></col>
                <col style={{ width: "max(50%, 30ch)" }}></col>
                <col style={{ width: "fit-content" }}></col>
                <col style={{ width: "fit-content" }}></col>
                <col style={{ width: "max(50%, 30ch)" }}></col>
                <col style={{ width: "min-content" }}></col>
              </colgroup>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Details</th>
                  <th>Price</th>
                  <th>Weight (oz)</th>
                  <th>Description</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.sku}>
                    <td className="sku-cell">{row.sku}</td>
                    <td>{row.label}</td>
                    <td>{row.priceDollars || "—"}</td>
                    <td className="ta-cen">
                      {row.weightOzVariant ?? row.baseWeightOz ?? "—"}
                    </td>
                    <td className="clr-muted">
                      {truncate(row.descriptionVariant, 30) ?? "—"}
                    </td>
                    <td className="variant-actions padding-i-half ">
                      <div className="grid gap-1 pc-cen">
                        <button
                          className="small"
                          type="button"
                          aria-label="Edit variant"
                          onClick={() =>
                            canEdit && onEditVariantRequest(row, group)
                          }
                          disabled={!canEdit}
                        >
                          <Pencil aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="small"
                          aria-label="Delete variant"
                          onClick={() =>
                            canEdit && onDeleteVariantRequest(row, group)
                          }
                          disabled={!canEdit}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </details>
  );
}

export default function ProductsPage() {
  const { state, loadCatalog } = useCatalog();
  const { user } = useAuth();
  const { catalog, loading, error } = state;
  const canEdit = user?.canEdit ?? false;

  const [showCreate, setShowCreate] = useState(false);
  const [lastCreated, setLastCreated] = useState<string | null>(null);
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogGroup | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<DialogConfirmStatus>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingAddVariants, setPendingAddVariants] =
    useState<CatalogGroup | null>(null);
  const [pendingDeleteVariant, setPendingDeleteVariant] = useState<{
    row: CatalogRow;
    group: CatalogGroup;
  } | null>(null);
  const [pendingEditVariant, setPendingEditVariant] = useState<{
    row: CatalogRow;
    group: CatalogGroup;
  } | null>(null);
  type SyncRequest = { type: "single"; group: CatalogGroup } | { type: "all" };
  const [syncRequest, setSyncRequest] = useState<SyncRequest | null>(null);
  const [publishDrafts, setPublishDrafts] = useState(false);
  const [publishStatus, setPublishStatus] =
    useState<DialogConfirmStatus>("idle");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [pendingEdit, setPendingEdit] = useState<CatalogGroup | null>(null);
  const [lastEdited, setLastEdited] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog && !loading) {
      loadCatalog();
    }
  }, []);

  const handleCreated = (sku: string) => {
    setShowCreate(false);
    setLastCreated(sku);
    setLastDeleted(null);
    setLastEdited(null);
    loadCatalog();
  };

  const performDeleteProduct = async (group: CatalogGroup): Promise<void> => {
    const res = await fetch(
      `/api/catalog/product/${encodeURIComponent(group.sku)}`,
      { method: "DELETE", credentials: "include" },
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Delete failed");
    setLastDeleted(group.sku);
    setLastCreated(null);
    setLastEdited(null);
    await loadCatalog();
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setDeleteStatus("confirming");
    setDeleteError(null);
    try {
      await performDeleteProduct(pendingDelete);
      setPendingDelete(null);
      setDeleteStatus("idle");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unknown error");
      setDeleteStatus("idle");
    }
  };

  const handlePublishConfirm = async () => {
    if (!syncRequest) return;
    setPublishStatus("confirming");
    setPublishError(null);
    try {
      const body =
        syncRequest.type === "single"
          ? {
              mode: "selected" as const,
              productIds: [syncRequest.group.productId],
              publish: syncRequest.group.publishedStatus === "draft",
            }
          : { mode: "sync_all" as const, publish: publishDrafts };

      const res = await fetch("/api/catalog/sync_to_site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Sync failed");

      let summary: string;
      if (syncRequest.type === "single") {
        const result = data.results?.[0];
        if (!result || result.status === "failed") {
          throw new Error(result?.error || "Sync failed");
        }
        summary = `Synced to site — ${syncRequest.group.sku}`;
      } else {
        const parts = [`${data.syncedCount} synced`];
        if (data.skippedUnchangedCount)
          parts.push(`${data.skippedUnchangedCount} unchanged`);
        if (data.skippedDraftCount)
          parts.push(`${data.skippedDraftCount} drafts skipped`);
        if (data.failedCount) parts.push(`${data.failedCount} failed`);
        summary = `Sync all complete — ${parts.join(", ")}`;
        if (data.failedCount) {
          const firstFailure = (
            data.results as Array<{
              status: string;
              sku: string;
              error?: string;
            }>
          ).find((r) => r.status === "failed");
          if (firstFailure) {
            throw new Error(
              `${summary}. First failure (${firstFailure.sku}): ${firstFailure.error}`,
            );
          }
        }
      }

      setPublishStatus("success");
      setLastSynced(summary);
      setLastCreated(null);
      setLastDeleted(null);
      setLastEdited(null);
      await loadCatalog();
      setSyncRequest(null);
      setPublishStatus("idle");
      setPublishDrafts(false);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Unknown error");
      setPublishStatus("idle");
    }
  };

  const statusMessage = loading
    ? "Loading catalog…"
    : lastCreated
      ? `Created — new SKU: ${lastCreated}`
      : lastDeleted
        ? `Deleted — SKU: ${lastDeleted}`
        : lastSynced
          ? lastSynced
          : lastEdited
            ? `Saved — ${lastEdited}`
            : error
              ? error
              : catalog
                ? `${catalog.summary.productCount} products · ${catalog.summary.rowCount} variants`
                : "";

  const statusTone = error
    ? "error"
    : lastCreated || lastEdited || lastSynced
      ? "success"
      : undefined;

  return (
    <>
      <section className="toolbar card">
        <div className="row gap-1 jc-sb ai-cen fw-wrap">
          <p
            className="status-line"
            role={statusTone === "error" ? "alert" : "status"}
            data-tone={statusTone ?? (loading ? "loading" : "")}
          >
            {statusMessage}
          </p>

          <div className="row gap-1 fw-wrap ai-cen">
            <button
              type="button"
              className="btn-secondary btn-lg row gap-half ai-cen"
              onClick={() => loadCatalog()}
              disabled={loading}
            >
              <RefreshCw aria-hidden="true" />
              <span>Refresh</span>
            </button>
            {canEdit && (
              <button
                type="button"
                className="btn-secondary btn-lg row gap-half ai-cen"
                onClick={() => setShowCreate(true)}
                disabled={loading}
              >
                <Plus aria-hidden="true" />
                <span>New Product</span>
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                className="btn-primary btn-lg row gap-half ai-cen"
                onClick={() => {
                  setSyncRequest({ type: "all" });
                  setPublishDrafts(false);
                  setPublishStatus("idle");
                  setPublishError(null);
                  setLastCreated(null);
                  setLastDeleted(null);
                  setLastEdited(null);
                }}
                disabled={loading || !catalog?.groups.length}
              >
                <Globe aria-hidden="true" />
                <span>Sync All</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {catalog && (
        <section className="grid gap-1">
          {catalog.groups.map((group) => (
            <ProductGroup
              key={group.productId}
              group={group}
              canEdit={canEdit}
              onDeleteRequest={setPendingDelete}
              onAddVariantsRequest={setPendingAddVariants}
              onDeleteVariantRequest={(row, grp) =>
                setPendingDeleteVariant({ row, group: grp })
              }
              onEditVariantRequest={(row, grp) =>
                setPendingEditVariant({ row, group: grp })
              }
              onPublishRequest={(grp) => {
                setSyncRequest({ type: "single", group: grp });
                setPublishStatus("idle");
                setPublishError(null);
                setLastCreated(null);
                setLastDeleted(null);
                setLastSynced(null);
              }}
              onEditRequest={setPendingEdit}
            />
          ))}
        </section>
      )}

      {pendingEdit && (
        <DialogEditProduct
          group={pendingEdit}
          onClose={() => setPendingEdit(null)}
          onSaved={() => {
            const sku = pendingEdit.sku;
            setPendingEdit(null);
            setLastCreated(null);
            setLastDeleted(null);
            setLastEdited(sku);
            loadCatalog();
          }}
        />
      )}

      {pendingEditVariant && (
        <DialogEditVariant
          row={pendingEditVariant.row}
          group={pendingEditVariant.group}
          onClose={() => setPendingEditVariant(null)}
          onSaved={async () => {
            const sku = pendingEditVariant.row.sku;
            setPendingEditVariant(null);
            setLastCreated(null);
            setLastDeleted(null);
            setLastEdited(sku);
            await loadCatalog();
          }}
        />
      )}

      {showCreate && (
        <DialogCreateProduct
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {pendingAddVariants && (
        <DialogCreateVariant
          group={pendingAddVariants}
          onClose={() => setPendingAddVariants(null)}
          onCreated={(skus) => {
            setPendingAddVariants(null);
            setLastCreated(skus[0] ?? null);
            setLastDeleted(null);
            loadCatalog();
          }}
        />
      )}

      {pendingDeleteVariant && (
        <DialogDeleteVariant
          row={pendingDeleteVariant.row}
          group={pendingDeleteVariant.group}
          onClose={() => setPendingDeleteVariant(null)}
          onDeleted={async (sku) => {
            setLastDeleted(sku);
            setLastCreated(null);
            setLastEdited(null);
            await loadCatalog();
            setPendingDeleteVariant(null);
          }}
          onDeleteProduct={async (group) => {
            await performDeleteProduct(group);
            setPendingDeleteVariant(null);
          }}
        />
      )}

      {pendingDelete && (
        <DialogConfirm
          title="Delete product?"
          confirmIcon={<Trash2 aria-hidden="true" />}
          confirmLabel="Delete"
          confirmingLabel="Deleting…"
          confirmVariant="danger"
          status={deleteStatus}
          successMessage="Deleted — reloading catalog…"
          error={deleteError}
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => setPendingDelete(null)}
        >
          <p className="small">
            <strong>{pendingDelete.displayName}</strong>
            <span className="clr-muted"> · {pendingDelete.sku}</span>
          </p>
          <p className="small clr-muted">
            This will permanently remove the product
            {pendingDelete.rowCount > 0
              ? `, its ${pendingDelete.rowCount} variant${pendingDelete.rowCount !== 1 ? "s" : ""},`
              : ","}{" "}
            its descriptions, and its inventory index entries from the sheet.
          </p>
          <p className="small clr-warning">
            This does not remove the product from the website. Archive or delete
            it in WooCommerce separately.
          </p>
        </DialogConfirm>
      )}

      {syncRequest?.type === "single" &&
        (() => {
          const isDraft = syncRequest.group.publishedStatus === "draft";
          const isLive = Boolean(syncRequest.group.wooId);
          // Never-published draft -> "publish". Already-live product flipped
          // back to draft -> "unpublish" (takes it off the live site).
          // Anything else -> routine content sync.
          const mode = !isDraft ? "sync" : isLive ? "unpublish" : "publish";

          return (
            <DialogConfirm
              title={
                mode === "publish"
                  ? "Publish this product?"
                  : mode === "unpublish"
                    ? "Take this product offline?"
                    : "Sync changes to the site?"
              }
              confirmIcon={<Globe aria-hidden="true" />}
              confirmLabel={
                mode === "publish"
                  ? "Publish & sync"
                  : mode === "unpublish"
                    ? "Unpublish"
                    : "Sync now"
              }
              confirmingLabel="Syncing…"
              confirmingIcon={<span className="loader" />}
              confirmVariant={mode === "unpublish" ? "danger" : "primary"}
              status={publishStatus}
              successMessage="Synced — reloading catalog…"
              error={publishError}
              onConfirm={() => void handlePublishConfirm()}
              onCancel={() => setSyncRequest(null)}
            >
              <p className="small">
                <strong>{syncRequest.group.displayName}</strong>
                <span className="clr-muted"> · {syncRequest.group.sku}</span>
              </p>
              {mode === "publish" && (
                <>
                  <p className="small clr-warning">
                    This product is currently a draft. Publishing will make it
                    live on the site.
                  </p>
                  <p className="small clr-muted">
                    {syncRequest.group.rowCount === 0 ? (
                      <>
                        Initial stock will be set to{" "}
                        <strong>{syncRequest.group.stockQty ?? 0}</strong> from
                        the sheet
                        {(syncRequest.group.stockQty ?? 0) === 0
                          ? " — it will publish as out of stock"
                          : ""}
                        . After this, stock is only updated by the inventory
                        sync.
                      </>
                    ) : (
                      <>
                        Each variant's initial stock will be set from its
                        current sheet value (
                        {syncRequest.group.rows
                          .map((r) => `${r.label}: ${r.stockQty ?? 0}`)
                          .join(", ")}
                        ). After this, stock is only updated by the inventory
                        sync.
                      </>
                    )}
                  </p>
                </>
              )}
              {mode === "unpublish" && (
                <p className="small clr-warning">
                  This product is currently live. Taking it offline will hide it
                  from the site immediately.
                </p>
              )}
              {mode === "sync" && (
                <p className="small clr-muted">
                  Pushes current name, description, price, sale price, category,
                  and variant details to WooCommerce. Stock is not affected.
                </p>
              )}
            </DialogConfirm>
          );
        })()}

      {syncRequest?.type === "all" &&
        catalog &&
        (() => {
          const totalCount = catalog.groups.length;
          const draftGroups = catalog.groups.filter(
            (g) => g.publishedStatus === "draft",
          );
          const draftCount = draftGroups.filter((g) => !g.wooId).length;
          const unpublishCount = draftGroups.filter((g) => g.wooId).length;
          return (
            <DialogConfirm
              title="Sync all products to the site?"
              confirmIcon={<Globe aria-hidden="true" />}
              confirmLabel="Sync all"
              confirmingLabel="Syncing…"
              confirmVariant="primary"
              status={publishStatus}
              successMessage="Synced — reloading catalog…"
              error={publishError}
              onConfirm={() => void handlePublishConfirm()}
              onCancel={() => setSyncRequest(null)}
            >
              <p className="small">
                Checks all <strong>{totalCount}</strong> product
                {totalCount !== 1 ? "s" : ""} for changes and pushes anything
                that's changed since its last sync. Unchanged products are
                skipped automatically. Stock is not affected.
              </p>
              {draftCount > 0 && (
                <label className="row gap-half ai-cen small">
                  <input
                    type="checkbox"
                    checked={publishDrafts}
                    onChange={(e) => setPublishDrafts(e.target.checked)}
                  />
                  <span>
                    Also publish {draftCount} draft
                    {draftCount !== 1 ? "s" : ""} that{" "}
                    {draftCount !== 1 ? "haven't" : "hasn't"} gone live yet
                  </span>
                </label>
              )}
              {unpublishCount > 0 && (
                <p className="small clr-warning">
                  {unpublishCount} product{unpublishCount !== 1 ? "s" : ""}{" "}
                  {unpublishCount !== 1 ? "are" : "is"} live but now marked
                  draft — {unpublishCount !== 1 ? "they" : "it"} will be taken
                  offline.
                </p>
              )}
            </DialogConfirm>
          );
        })()}
    </>
  );
}

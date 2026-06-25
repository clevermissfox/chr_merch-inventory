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
          <strong>{group.displayName}</strong>
          <p className="summary-count">
            {isSimple
              ? "Simple product"
              : `${group.rowCount} SKU${group.rowCount !== 1 ? "s" : ""}`}
          </p>
        </div>
        <span className="toggle-label">Toggle</span>
      </summary>

      <div className="product-body row fw-wrap gap-1">
        <div className="product-info flex-1 padding-b-three-forths padding-i-1quarter">
          <dl className="product-meta">
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
          </dl>

          {group.primaryDescription && (
            <div className="product-desc">
              <span className="product-desc__label">Description</span>
              <p>{truncate(group.primaryDescription, 120)}</p>
            </div>
          )}
          {group.shortDescription && (
            <div className="product-desc">
              <span className="product-desc__label">Short Description</span>
              <p>{truncate(group.shortDescription, 120)}</p>
            </div>
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
  const [publishPending, setPublishPending] = useState<CatalogGroup | null>(
    null,
  );
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

  const statusMessage = loading
    ? "Loading catalog…"
    : lastCreated
      ? `Created — new SKU: ${lastCreated}`
      : lastDeleted
        ? `Deleted — SKU: ${lastDeleted}`
        : lastEdited
          ? `Saved — ${lastEdited}`
          : publishPending
            ? `WooCommerce push coming soon — ${publishPending.displayName}`
            : error
              ? error
              : catalog
                ? `${catalog.summary.productCount} products · ${catalog.summary.rowCount} variants`
                : "";

  const statusTone = error
    ? "error"
    : publishPending
      ? "warning"
      : lastCreated || lastEdited
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

          {canEdit && (
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
              <button
                type="button"
                className="btn-primary btn-lg row gap-half ai-cen"
                onClick={() => setShowCreate(true)}
                disabled={loading}
              >
                <Plus aria-hidden="true" />
                <span>New Product</span>
              </button>
            </div>
          )}
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
                setPublishPending(grp);
                setLastCreated(null);
                setLastDeleted(null);
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
    </>
  );
}

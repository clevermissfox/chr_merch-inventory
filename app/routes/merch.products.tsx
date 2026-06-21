import { useEffect, useState } from "react";
import type { Route } from "./+types/merch.products";
import { useCatalog } from "~/context/CatalogContext";
import { useAuth } from "~/context/AuthContext";
import CreateProductDialog from "~/components/CreateProductDialog";
import ConfirmDeleteDialog from "~/components/ConfirmDeleteDialog";
import type { CatalogGroup } from "~/types/catalog";

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

interface ProductGroupProps {
  group: CatalogGroup;
  canEdit: boolean;
  onDeleteRequest: (group: CatalogGroup) => void;
}

function ProductGroup({ group, canEdit, onDeleteRequest }: ProductGroupProps) {
  return (
    <details className="inventory-group card" open={false}>
      <summary>
        <div className="summary-title">
          <strong>{group.displayName}</strong>
          <span className="summary-count">
            {group.rowCount} variant{group.rowCount !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="toggle-label">Toggle</span>
      </summary>

      <div className="table-wrapper">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Variant</th>
              <th>Price</th>
              <th className="ta-cen">Stock</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((row) => (
              <tr key={row.sku}>
                <td className="sku-cell">{row.sku}</td>
                <td className="variant-cell">{row.label}</td>
                <td>${row.priceDollars}</td>
                <td className="ta-cen">{row.stockQty ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="row gap-half jc-end padding-b-half">
          <button
            type="button"
            className="btn-secondary row gap-half"
            disabled
          >
            <i className="bi bi-pencil" aria-hidden="true" />
            Edit
          </button>
          <button
            type="button"
            className="btn-danger row gap-half"
            onClick={() => onDeleteRequest(group)}
          >
            <i className="bi bi-trash" aria-hidden="true" />
            Delete
          </button>
        </div>
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
  const [pendingDelete, setPendingDelete] = useState<CatalogGroup | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog && !loading) {
      loadCatalog();
    }
  }, []);

  const handleCreated = (sku: string) => {
    setShowCreate(false);
    setLastCreated(sku);
    loadCatalog();
  };

  const handleDeleteConfirm = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(
        `/api/catalog/product/${encodeURIComponent(pendingDelete.sku)}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Delete failed");

      setPendingDelete(null);
      loadCatalog();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setDeleting(false);
    }
  };

  const statusMessage = loading
    ? "Loading catalog…"
    : lastCreated
      ? `Created — new SKU: ${lastCreated}`
      : deleteError
        ? deleteError
        : error
          ? error
          : catalog
            ? `${catalog.summary.productCount} products · ${catalog.summary.rowCount} variants`
            : "";

  const statusTone = error || deleteError ? "error" : undefined;

  return (
    <>
      <section className="toolbar grid gap-1 card">
        <div className="toolbar-row row gap-1 jc-sb ai-cen fw-wrap">
          <div>
            <div className="badge">
              {canEdit ? "Editor Access" : "View Access"}
            </div>
            <div className="small">{user?.email ?? "Authorized user"}</div>
          </div>

          {canEdit && (
            <div className="toolbar-actions row gap-1 fw-wrap ai-cen">
              <button
                type="button"
                className="btn-primary row gap-half jc-cen"
                onClick={() => setShowCreate(true)}
                disabled={loading}
              >
                <i className="bi bi-plus-lg" aria-hidden="true" />
                New Product
              </button>
              <button
                type="button"
                className="btn-secondary row gap-half jc-cen"
              >
                <i className="bi bi-arrow-clockwise" aria-hidden="true" />
                Refresh
              </button>
            </div>
          )}
        </div>

        <div className="toolbar-row row gap-1 jc-sb ai-cen fw-wrap">
          <div
            className="status-line"
            role={statusTone === "error" ? "alert" : "status"}
            data-tone={statusTone}
          >
            <span>{statusMessage}</span>
            {loading && <span className="loader" />}
          </div>
        </div>
      </section>

      {catalog && (
        <section className="inventory-groups">
          {catalog.groups.map((group) => (
            <ProductGroup
              key={group.productId}
              group={group}
              canEdit={canEdit}
              onDeleteRequest={setPendingDelete}
            />
          ))}
        </section>
      )}

      {showCreate && (
        <CreateProductDialog
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteDialog
          displayName={pendingDelete.displayName}
          sku={pendingDelete.sku}
          variantCount={pendingDelete.rowCount}
          deleting={deleting}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            if (!deleting) setPendingDelete(null);
          }}
        />
      )}
    </>
  );
}

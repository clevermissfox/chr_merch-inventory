import { useEffect, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import type { CatalogGroup, CatalogRow } from "~/types/catalog";

interface Props {
  row: CatalogRow;
  group: CatalogGroup;
  onClose: () => void;
  /**
   * convertedToSimpleProductId is set whenever this delete was the last
   * variant — regardless of whether the Woo-side type-conversion API call
   * itself succeeded, since that's a separate concern from "does this
   * product now need a stock decision." The caller re-checks the parent's
   * actual wooId from the reloaded catalog to decide whether anything needs
   * to sync at all (a never-published parent has nothing to reconcile).
   */
  onDeleted: (
    sku: string,
    convertedToSimpleProductId?: string,
  ) => Promise<void>;
  onDeleteProduct: (group: CatalogGroup) => Promise<void>;
}

type Status = "idle" | "deleting-variant" | "deleting-product";

export default function DialogDeleteVariant({
  row,
  group,
  onClose,
  onDeleted,
  onDeleteProduct,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const isLast = group.rowCount === 1;

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const handleNativeCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    if (status !== "idle") {
      e.preventDefault();
      return;
    }
    onClose();
  };

  const doDeleteVariant = async () => {
    setStatus("deleting-variant");
    setError(null);
    try {
      const res = await fetch(
        `/api/catalog/variant/${encodeURIComponent(row.sku)}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Delete failed");
      await onDeleted(
        row.sku,
        data.wasLastVariant ? data.productId : undefined,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("idle");
    }
  };

  const doDeleteProduct = async () => {
    setStatus("deleting-product");
    setError(null);
    try {
      await onDeleteProduct(group);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("idle");
    }
  };

  const inFlight = status !== "idle";

  return (
    <dialog
      ref={ref}
      className="dialog dialog-confirm card"
      onCancel={handleNativeCancel}
    >
      <div className="dialog-inner dialog-confirm-inner grid gap-1">
        <div className="row jc-sb gap-1 fw-wrap-reverse">
          <h2 className="dialog-confirm-title">
            {isLast ? "Last variant" : "Delete variant?"}
          </h2>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={inFlight}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-1">
          <p className="small">
            <strong>{row.sku}</strong>
            {row.variantDetails && (
              <span className="clr-muted"> · {row.variantDetails}</span>
            )}
          </p>

          {isLast ? (
            <p className="small clr-muted">
              This is the only variant of <strong>{group.displayName}</strong>.
              Deleting it will leave the product with no variants. If you
              convert to simple product you'll be asked for a new stock quantity
              prior to syncing. Choose how to proceed:
            </p>
          ) : (
            <p className="small clr-muted">
              This will permanently remove the variant, its descriptions, and
              its inventory index entry from the sheet.
            </p>
          )}

          {row.wooVariantId && (
            <p className="small clr-warning">
              This variant will also be permanently deleted from WooCommerce.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="small status-line" data-tone="error">
            {error}
          </p>
        )}

        <div className="dialog-confirm-actions">
          <button
            type="button"
            className="btn-secondary row ai-cen gap-half"
            onClick={() => void doDeleteVariant()}
            disabled={inFlight}
          >
            {status !== "deleting-variant" && <Trash2 aria-hidden="true" />}
            <span
              className={status === "deleting-variant" ? "render-loader" : ""}
            >
              {isLast ? "Convert to simple product" : "Delete variant"}
            </span>
          </button>

          {isLast && (
            <button
              type="button"
              className="btn-primary btn-danger row ai-cen gap-half"
              onClick={() => void doDeleteProduct()}
              disabled={inFlight}
            >
              {status !== "deleting-product" && <Trash2 aria-hidden="true" />}
              <span
                className={status === "deleting-product" ? "render-loader" : ""}
              >
                {status === "deleting-product"
                  ? "Deleting…"
                  : "Delete entire product"}
              </span>
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}

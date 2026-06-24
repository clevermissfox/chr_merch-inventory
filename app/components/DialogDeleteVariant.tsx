import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { CatalogGroup, CatalogRow } from "~/types/catalog";

interface Props {
  row: CatalogRow;
  group: CatalogGroup;
  onClose: () => void;
  onDeleted: (sku: string) => Promise<void>;
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
      await onDeleted(row.sku);
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
        <h2 className="dialog-confirm-title">
          {isLast ? "Last variant" : "Delete variant?"}
        </h2>

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
              Deleting it will leave the product with no variants. Choose how to
              proceed:
            </p>
          ) : (
            <p className="small clr-muted">
              This will permanently remove the variant, its descriptions, and
              its inventory index entry from the sheet.
            </p>
          )}

          <p className="small clr-warning">
            This does not remove anything from WooCommerce. Update the site
            separately.
          </p>
        </div>

        {error && (
          <p role="alert" className="small status-line" data-tone="error">
            {error}
          </p>
        )}

        <div className="dialog-confirm-actions">
          <button
            type="button"
            className="btn-primary btn-danger row ai-cen gap-half"
            onClick={() => void doDeleteVariant()}
            disabled={inFlight}
          >
            {status === "deleting-variant" ? (
              <span className="loader" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            <span>
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
              {status === "deleting-product" ? (
                <span className="loader" aria-hidden="true" />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              <span>
                {status === "deleting-product"
                  ? "Deleting…"
                  : "Delete entire product"}
              </span>
            </button>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={inFlight}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}

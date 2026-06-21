import { useEffect, useRef } from "react";

interface ConfirmDeleteDialogProps {
  displayName: string;
  sku: string;
  variantCount: number;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDeleteDialog({
  displayName,
  sku,
  variantCount,
  deleting,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog dialog-confirm" onCancel={onCancel}>
      <div className="dialog-confirm-inner card grid gap-1">
        <h2 className="dialog-confirm-title">Delete product?</h2>
        <p className="small">
          <strong>{displayName}</strong>
          <span className="clr-muted"> · {sku}</span>
        </p>
        <p className="small clr-muted">
          This will permanently remove the product
          {variantCount > 0
            ? `, its ${variantCount} variant${variantCount !== 1 ? "s" : ""},`
            : ","}{" "}
          its descriptions, and its inventory index entries from the sheet.
        </p>
        <p className="small clr-warning">
          This does not remove the product from the website. Archive or delete
          it in WooCommerce separately.
        </p>
        <div className="dialog-confirm-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

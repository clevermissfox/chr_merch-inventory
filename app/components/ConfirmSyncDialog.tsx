import { useEffect, useRef } from "react";

interface ConfirmSyncDialogProps {
  groups: Array<{ displayName: string; skuCount: number }>;
  totalSkus: number;
  saving: boolean;
  wooSiteUrl?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmSyncDialog({
  groups,
  totalSkus,
  saving,
  wooSiteUrl,
  onConfirm,
  onCancel,
}: ConfirmSyncDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const targetSite = wooSiteUrl;

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="confirm-dialog" onCancel={onCancel}>
      <div className="confirm-dialog-inner card grid gap-1">
        <h2 className="confirm-dialog-title">Push stock to website</h2>
        <p className="small clr-muted">
          These products will be updated on{" "}
          {`${targetSite ? targetSite : "CHR website"}`}:
        </p>
        <ul className="confirm-dialog-list" role="list">
          {groups.map((g) => (
            <li key={g.displayName} className="confirm-dialog-item">
              <span>{g.displayName}</span>
              <span className="confirm-dialog-count">
                {g.skuCount} SKU{g.skuCount !== 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving
              ? "Pushing…"
              : `Push ${totalSkus} SKU${totalSkus !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </dialog>
  );
}

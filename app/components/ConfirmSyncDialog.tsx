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
    <dialog ref={ref} className="dialog dialog-confirm" onCancel={onCancel}>
      <div className="dialog-confirm-inner card grid gap-1">
        <h2 className="dialog-confirm-title">Push stock to website</h2>
        <p className="small clr-muted">
          These products will be updated on{" "}
          {`${targetSite ? targetSite : "CHR website"}`}:
        </p>
        <ul className="dialog-confirm-list" role="list">
          {groups.map((g) => (
            <li key={g.displayName} className="dialog-confirm-item">
              <span>{g.displayName}</span>
              <span className="dialog-confirm-count">
                {g.skuCount} SKU{g.skuCount !== 1 ? "s" : ""}
              </span>
            </li>
          ))}
        </ul>
        <div className="dialog-confirm-actions">
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

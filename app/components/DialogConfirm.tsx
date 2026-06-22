import { useEffect, useRef } from "react";

export type DialogConfirmStatus = "idle" | "confirming" | "success";

interface DialogConfirmProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  confirmingLabel?: string;
  confirmVariant?: "danger" | "primary";
  status: DialogConfirmStatus;
  successMessage?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DialogConfirm({
  title,
  children,
  confirmLabel,
  confirmingLabel,
  confirmVariant = "primary",
  status,
  successMessage,
  error,
  onConfirm,
  onCancel,
}: DialogConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const handleNativeCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    if (status !== "idle") {
      e.preventDefault();
      return;
    }
    onCancel();
  };

  const inFlight = status === "confirming" || status === "success";

  return (
    <dialog ref={ref} className="dialog dialog-confirm" onCancel={handleNativeCancel}>
      <div className="dialog-confirm-inner card grid gap-1">
        <h2 className="dialog-confirm-title">{title}</h2>

        {status === "success" && successMessage ? (
          <div role="status" className="status-line">
            <span>{successMessage}</span>
            <span className="loader" />
          </div>
        ) : (
          children
        )}

        {error && (
          <p role="alert" className="small" data-tone="error">
            {error}
          </p>
        )}

        <div className="dialog-confirm-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={inFlight}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn-${confirmVariant}`}
            onClick={onConfirm}
            disabled={inFlight}
          >
            {status === "confirming" && confirmingLabel
              ? confirmingLabel
              : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

import { useEffect, useRef } from "react";

export type DialogConfirmStatus = "idle" | "confirming" | "success";

interface DialogConfirmProps {
  title: string;
  children: React.ReactNode;
  confirmIcon?: React.ReactNode;
  confirmLabel: string;
  confirmingIcon?: React.ReactNode;
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
  confirmIcon,
  confirmLabel,
  confirmingIcon,
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
    <dialog
      ref={ref}
      className="dialog-confirm card"
      onCancel={handleNativeCancel}
    >
      <div className="dialog-inner dialog-confirm-inner grid gap-1">
        <h2 className="dialog-confirm-title">{title}</h2>

        {status === "success" && successMessage ? (
          <p role="status" className="status-line" data-tone="success">
            <span>{successMessage}</span>
          </p>
        ) : (
          children
        )}

        {error && (
          <p role="alert" className="small status-line" data-tone="error">
            {error}
          </p>
        )}

        <div className="dialog-confirm-actions">
          <button
            type="button"
            className={`btn-primary btn-${confirmVariant} row ai-cen gap-half`}
            onClick={onConfirm}
            disabled={inFlight}
          >
            {status !== "confirming"
              ? confirmIcon
              : confirmingIcon
                ? confirmingIcon
                : confirmIcon}
            <span>
              {status === "confirming" && confirmingLabel
                ? confirmingLabel
                : confirmLabel}
            </span>
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={onCancel}
            disabled={inFlight}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}

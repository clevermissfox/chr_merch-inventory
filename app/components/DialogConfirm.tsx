import { useEffect, useRef, useState } from "react";

export type DialogConfirmStatus = "idle" | "confirming" | "success";

interface DialogConfirmProps {
  title: string;
  children: React.ReactNode;
  confirmIcon?: React.ReactNode;
  confirmLabel: string;
  /** Shown via the shared render-loader spinner while the confirm button's own action is in flight. */
  confirmingLabel?: string;
  confirmVariant?: "danger" | "primary";
  status: DialogConfirmStatus;
  successMessage?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Optional second choice alongside confirm/cancel, for a genuine either/or decision (not just confirm-or-abort) */
  secondaryIcon?: React.ReactNode;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Shown via the shared render-loader spinner while the secondary button's own action is in flight — falls back to confirmingLabel if the two actions share the same in-flight wording. */
  secondaryConfirmingLabel?: string;
  /** Disables just the confirm button (e.g. while background data needed to know what "confirm" even does is still loading) — unlike status="confirming", Cancel stays clickable since nothing is in-flight that a cancel would interrupt. */
  confirmDisabled?: boolean;
}

export default function DialogConfirm({
  title,
  children,
  confirmIcon,
  confirmLabel,
  confirmingLabel,
  confirmVariant = "primary",
  status,
  successMessage,
  error,
  onConfirm,
  onCancel,
  secondaryIcon,
  secondaryLabel,
  onSecondary,
  secondaryConfirmingLabel,
  confirmDisabled,
}: DialogConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // status is a single shared value the caller sets regardless of which
  // button triggered it — track which one locally so only the button that
  // was actually clicked shows the "confirming" swap, not always the
  // primary one.
  const [activeButton, setActiveButton] = useState<"confirm" | "secondary" | null>(
    null,
  );

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (status === "idle") setActiveButton(null);
  }, [status]);

  const handleNativeCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    if (status !== "idle") {
      e.preventDefault();
      return;
    }
    onCancel();
  };

  const inFlight = status === "confirming" || status === "success";
  const confirmActive = activeButton === "confirm";
  const secondaryActive = activeButton === "secondary";

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
            onClick={() => {
              setActiveButton("confirm");
              onConfirm();
            }}
            disabled={inFlight || confirmDisabled}
          >
            {status === "confirming" && confirmActive ? (
              <span className="render-loader">
                {confirmingLabel ?? confirmLabel}
              </span>
            ) : (
              <>
                {confirmIcon}
                <span>{confirmLabel}</span>
              </>
            )}
          </button>
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              className="btn-secondary row ai-cen gap-half"
              onClick={() => {
                setActiveButton("secondary");
                onSecondary();
              }}
              disabled={inFlight}
            >
              {status === "confirming" && secondaryActive ? (
                <span className="render-loader">
                  {secondaryConfirmingLabel ?? confirmingLabel ?? secondaryLabel}
                </span>
              ) : (
                <>
                  {secondaryIcon}
                  <span>{secondaryLabel}</span>
                </>
              )}
            </button>
          )}
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

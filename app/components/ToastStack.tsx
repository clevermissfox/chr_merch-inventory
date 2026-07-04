import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useToast } from "~/context/ToastContext";

export default function ToastStack() {
  const { toasts, dismissToast } = useToast();
  const ref = useRef<HTMLDivElement>(null);

  // Every create/edit/delete/sync dialog in this app is a native <dialog>,
  // which renders in the browser's top layer — above regular position:fixed
  // content. A plain fixed-position toast fired while a dialog is still
  // visibly open (e.g. a confirm dialog showing its own success state for a
  // beat before closing) would render invisibly behind that dialog's
  // backdrop. The Popover API puts this container in that same top layer,
  // so it can stack above an already-open dialog instead of behind it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const isOpen = el.matches(":popover-open");
    if (toasts.length > 0 && !isOpen) {
      el.showPopover();
    } else if (toasts.length === 0 && isOpen) {
      el.hidePopover();
    }
  }, [toasts.length]);

  return (
    <div
      ref={ref}
      popover="manual"
      className="toast-stack"
      role="region"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast-item"
          data-tone={t.tone}
          role={t.tone === "error" ? "alert" : "status"}
        >
          <span>{t.message}</span>
          <button
            type="button"
            className="btn-icon"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

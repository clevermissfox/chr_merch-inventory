import { X } from "lucide-react";
import { useToast } from "~/context/ToastContext";

export default function ToastStack() {
  const { toasts, dismissToast } = useToast();

  if (!toasts.length) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
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

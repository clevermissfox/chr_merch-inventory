import { Bug, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useAuth } from "~/context/AuthContext";

interface DialogBugReportProps {
  onClose: () => void;
}

const SEVERITIES = [
  { value: "low", label: "Low — cosmetic, doesn't block me" },
  { value: "medium", label: "Medium — annoying, workaround exists" },
  { value: "high", label: "High — blocks what I was doing" },
  { value: "critical", label: "Critical — broke something / lost data" },
];

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function DialogBugReport({ onClose }: DialogBugReportProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { user } = useAuth();
  const location = useLocation();

  const [severity, setSeverity] = useState("medium");
  const [whatDidYouExpect, setWhatDidYouExpect] = useState("");
  const [whatHadYouDoneBefore, setWhatHadYouDoneBefore] = useState("");
  const [whatHappened, setWhatHappened] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const canSubmit =
    whatDidYouExpect.trim().length > 0 && whatHappened.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    setWarning(null);
    try {
      const body: Record<string, unknown> = {
        page: location.pathname,
        severity,
        whatDidYouExpect: whatDidYouExpect.trim(),
        whatHadYouDoneBefore: whatHadYouDoneBefore.trim(),
        whatHappened: whatHappened.trim(),
      };
      if (screenshot) {
        body.screenshot = {
          fileName: screenshot.name,
          fileData: await readAsBase64(screenshot),
          mimeType: screenshot.type,
        };
      }

      const res = await fetch("/api/bug_report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to submit report");
      if (data.warning) setWarning(data.warning);
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog-bug-report card" onCancel={onClose}>
      <div className="grid gap-1half dialog-inner">
        <div className="row jc-sb ai-cen">
          <h2>Report a bug</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {success ? (
          <div className="grid gap-1">
            <p role="status" className="status-line" data-tone="success">
              Report sent — thank you.
            </p>
            {warning && <p className="xsmall clr-warning">{warning}</p>}
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form className="grid gap-1" onSubmit={handleSubmit}>
            <p className="xsmall clr-muted">
              Reporting as <strong>{user?.email}</strong> on{" "}
              <span className="clr-muted">{location.pathname}</span>
            </p>

            <div className="form-group">
              <label className="bold" htmlFor="bug-severity">
                Severity
              </label>
              <select
                id="bug-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                disabled={submitting}
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="bold" htmlFor="bug-happened">
                What happened?
              </label>
              <textarea
                id="bug-happened"
                rows={3}
                value={whatHappened}
                onChange={(e) => setWhatHappened(e.target.value)}
                placeholder="What did you see instead of what you expected?"
                disabled={submitting}
                required
              />
            </div>

            <div className="form-group">
              <label className="bold" htmlFor="bug-expect">
                What did you expect to happen?
              </label>
              <textarea
                id="bug-expect"
                rows={2}
                value={whatDidYouExpect}
                onChange={(e) => setWhatDidYouExpect(e.target.value)}
                placeholder="e.g. Expected the product to be live on the site"
                disabled={submitting}
                required
              />
            </div>

            <div className="form-group">
              <label className="bold" htmlFor="bug-before">
                What actions had you taken prior?{" "}
                <span className="clr-muted xsmall">(optional)</span>
              </label>
              <textarea
                id="bug-before"
                rows={2}
                value={whatHadYouDoneBefore}
                onChange={(e) => setWhatHadYouDoneBefore(e.target.value)}
                placeholder="e.g. Toggled CHR Solid Tshirt to Draft a few minutes earlier"
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="bold" htmlFor="bug-screenshot">
                Screenshot <span className="clr-muted xsmall">(optional)</span>
              </label>
              <input
                id="bug-screenshot"
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
                disabled={submitting}
              />
              {screenshot && (
                <p className="xsmall clr-muted">{screenshot.name}</p>
              )}
            </div>

            {error && (
              <p role="alert" className="status-line" data-tone="error">
                {error}
              </p>
            )}

            <div className="row gap-half">
              <button
                type="submit"
                className="btn-primary row gap-half ai-cen jc-cen flex-1"
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <span className="render-loader">Sending…</span>
                ) : (
                  <>
                    <Bug aria-hidden="true" />
                    <span>Send report</span>
                  </>
                )}
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

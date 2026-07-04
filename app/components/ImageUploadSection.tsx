import { CircleQuestionMark, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Shows the user's own filename (never our SKU-based rename, which only
// happens server-side on upload) — truncated so long names don't blow out
// the layout: first 12 chars, "...", then the last 9 (which keeps the
// extension visible for typical 3-4 char extensions).
function truncateFileName(name: string, maxLen = 24): string {
  if (name.length <= maxLen) return name;
  return `${name.slice(0, 12)}...${name.slice(-9)}`;
}

export interface StagedImage {
  mode: "url" | "file";
  files: File[];
  url: string;
  notes: string;
}

interface ImageUploadSectionProps {
  sku: string;
  productName: string;
  disabled?: boolean;
  /** Called when the section has unprocessed content (file selected or URL entered but not yet sent). Ignored in deferred mode. */
  onPendingChange?: (isPending: boolean) => void;
  /**
   * Stage the pick locally instead of sending immediately — for callers
   * where no SKU exists yet (e.g. creating a new product). The parent reads
   * the staged selection via onStagedChange and sends it itself once a SKU
   * is available.
   */
  deferred?: boolean;
  onStagedChange?: (staged: StagedImage) => void;
}

export default function ImageUploadSection({
  sku,
  productName,
  disabled,
  onPendingChange,
  deferred = false,
  onStagedChange,
}: ImageUploadSectionProps) {
  const apiEndpoint = `/api/catalog/product/${encodeURIComponent(sku)}/image`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"url" | "file">("file");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const canSubmit = mode === "url" ? url.trim().length > 0 : files.length > 0;
  const isPending = canSubmit && !success;

  useEffect(() => {
    if (deferred) return;
    onPendingChange?.(isPending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, deferred]);

  useEffect(() => {
    if (!deferred) return;
    onStagedChange?.({ mode, files, url: url.trim(), notes: notes.trim() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred, mode, files, url, notes]);

  const handleModeChange = (next: "url" | "file") => {
    setMode(next);
    setUrl("");
    setFiles([]);
    setError(null);
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClear = () => {
    setUrl("");
    setFiles([]);
    setNotes("");
    setError(null);
    setSuccess(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const readAsBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSend = async () => {
    setError(null);
    setSuccess(false);
    setSubmitting(true);

    try {
      let body: Record<string, unknown>;
      const trimmedNotes = notes.trim() || undefined;

      if (mode === "url") {
        if (!url.trim()) {
          setError("Paste an image or Drive link first.");
          return;
        }
        body = { productName, pastedUrl: url.trim(), notes: trimmedNotes };
      } else {
        if (files.length === 0) {
          setError("Select an image file.");
          return;
        }
        const encoded = await Promise.all(
          files.map(async (f) => ({
            fileName: f.name,
            fileData: await readAsBase64(f),
            mimeType: f.type,
          })),
        );
        body = { productName, files: encoded, notes: trimmedNotes };
      }

      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to send");

      setSuccess(true);
      setUrl("");
      setFiles([]);
      setNotes("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <fieldset className="form-fieldset grid gap-half">
      <legend className="row ai-cen gap-half">
        <p className="bold">
          Image <span className="clr-muted xsmall">(optional)</span>
        </p>
        <button
          type="button"
          className="btn-icon btn-help"
          onClick={() => setShowHint((v) => !v)}
          aria-expanded={showHint}
          disabled={disabled}
        >
          <CircleQuestionMark aria-hidden="true" />
        </button>
      </legend>
      {showHint && (
        <p className="xsmall clr-warning margin-be-half">
          Upload one or more images for this product. Developer is notified to
          optimize, watermark, and attach them. Allow 1–2 business days.
        </p>
      )}

      <div className="grid gap-half">
        <div className="row gap-1">
          <label
            className="row gap-half ai-cen bold"
            id={`img-radio-file-label-${sku}`}
          >
            <input
              id={`img-radio-file-${sku}`}
              type="radio"
              name={`img-mode-${sku}`}
              checked={mode === "file"}
              onChange={() => handleModeChange("file")}
              disabled={disabled || submitting}
            />
            Upload files
          </label>
          <label
            className="row gap-half ai-cen bold"
            id={`img-radio-url-label-${sku}`}
          >
            <input
              id={`img-radio-url-${sku}`}
              type="radio"
              name={`img-mode-${sku}`}
              checked={mode === "url"}
              onChange={() => handleModeChange("url")}
              disabled={disabled || submitting}
            />
            Paste Drive link
          </label>
        </div>

        {mode === "url" ? (
          <>
            <input
              id={`img-url-${sku}`}
              type="url"
              aria-labelledby={`img-radio-url-label-${sku}`}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSuccess(false);
              }}
              placeholder="https://drive.google.com/…"
              disabled={disabled || submitting}
            />
            <p className="xsmall clr-muted">
              Make sure the Drive file is shared with your developer.
            </p>
          </>
        ) : (
          <div className="grid gap-quarter">
            <input
              id={`img-file-${sku}`}
              className="visually-hidden"
              ref={fileInputRef}
              type="file"
              aria-labelledby={`img-radio-file-label-${sku}`}
              accept="image/*"
              multiple
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []);
                // A native file input's FileList is whatever was chosen in
                // *this* picker session, not additive — replacing `files`
                // wholesale here would silently drop anything picked
                // earlier (e.g. after removing one file and reopening the
                // picker to add another). Append instead, deduping by
                // name+size so re-picking the same file is a no-op.
                setFiles((prev) => {
                  const existingKeys = new Set(
                    prev.map((f) => `${f.name}:${f.size}`),
                  );
                  const additions = picked.filter(
                    (f) => !existingKeys.has(`${f.name}:${f.size}`),
                  );
                  return [...prev, ...additions];
                });
                setSuccess(false);
                // Reset so the same file(s) can be re-picked later — browsers
                // won't fire onChange again for an unchanged FileList. The
                // native input's own "no file chosen" label is never shown
                // (input is visually hidden) so this reset has no visible
                // side effect — the file list below is the only status UI.
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              disabled={disabled || submitting}
            />

            <label
              htmlFor={`img-file-${sku}`}
              className="pseudo-btn-secondary row gap-half ai-cen cursor-pointer"
            >
              <Upload size={12} aria-hidden="true" />
              <span>Choose image files</span>
            </label>

            {files.length > 0 && (
              <ul className="img-file-list small clr-muted" role="list">
                {files.map((f, i) => (
                  <li
                    key={`${f.name}:${f.size}`}
                    className="row gap-half ai-cen jc-sb padding-quarter"
                  >
                    <span title={f.name}>{truncateFileName(f.name)}</span>
                    {!submitting && (
                      <button
                        type="button"
                        aria-label={`Remove ${f.name}`}
                        className="btn-icon"
                        onClick={() => {
                          setFiles((prev) =>
                            prev.filter((_, idx) => idx !== i),
                          );
                          setSuccess(false);
                        }}
                        disabled={disabled}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {canSubmit && !success && (
          <div className="form-group">
            <label className="bold" htmlFor={`img-notes-${sku}`}>
              Notes for dev <span className="clr-muted xsmall">(optional)</span>
            </label>
            <textarea
              id={`img-notes-${sku}`}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. this is the black / small combo"
              disabled={disabled || submitting}
            />
          </div>
        )}

        {!deferred && isPending && (
          <p role="alert" className="status-line" data-tone="warning">
            {files.length > 1
              ? `${files.length} images selected — send them for processing or remove files before saving.`
              : "Send the image for processing or clear it before saving changes."}
          </p>
        )}

        {deferred ? (
          canSubmit && (
            <div className="row gap-half">
              <button
                type="button"
                className="btn-secondary row gap-half ai-cen"
                onClick={handleClear}
                disabled={disabled}
              >
                <X aria-hidden="true" />
                <span>{files.length > 1 ? "Clear all" : "Clear"}</span>
              </button>
            </div>
          )
        ) : success ? (
          <p role="status" className="status-line" data-tone="success">
            {files.length > 1
              ? `${files.length} images sent for processing.`
              : "Sent for processing."}
          </p>
        ) : (
          <>
            {error && (
              <p role="alert" className="status-line" data-tone="error">
                {error}
              </p>
            )}
            <div className="row gap-half">
              <button
                type="button"
                className="btn-secondary row gap-half ai-cen"
                onClick={() => void handleSend()}
                disabled={disabled || submitting || !canSubmit}
              >
                {submitting ? (
                  <span className="render-loader">Sending…</span>
                ) : (
                  <>
                    <Upload aria-hidden="true" />
                    <span>Send for processing</span>
                  </>
                )}
              </button>
              {canSubmit && !submitting && (
                <button
                  type="button"
                  className="btn-secondary row gap-half ai-cen"
                  onClick={handleClear}
                  disabled={disabled}
                >
                  <X aria-hidden="true" />
                  <span>{files.length > 1 ? "Clear all" : "Clear"}</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
}

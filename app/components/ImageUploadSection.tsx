import { CircleQuestionMark, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface ImageUploadSectionProps {
  sku: string;
  productName: string;
  disabled?: boolean;
  /** Restrict to a single file and write the URL back to the sheet (for variants) */
  single?: boolean;
  /** Existing image URL to display (for variants) */
  existingUrl?: string;
  /** Override the API endpoint. Defaults to /api/catalog/product/:sku/image */
  endpoint?: string;
  /** Called with the final URL when the image is saved to the sheet (single mode only) */
  onUploaded?: (url: string) => void;
  /** Called when the section has unprocessed content (file selected or URL entered but not yet sent) */
  onPendingChange?: (isPending: boolean) => void;
}

export default function ImageUploadSection({
  sku,
  productName,
  disabled,
  single = false,
  existingUrl,
  endpoint,
  onUploaded,
  onPendingChange,
}: ImageUploadSectionProps) {
  const apiEndpoint =
    endpoint ?? `/api/catalog/product/${encodeURIComponent(sku)}/image`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"url" | "file">("file");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);

  const canSubmit = mode === "url" ? url.trim().length > 0 : files.length > 0;
  const isPending = canSubmit && !success;

  useEffect(() => {
    onPendingChange?.(isPending);
  }, [isPending]); // eslint-disable-line react-hooks/exhaustive-deps

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

      if (mode === "url") {
        if (!url.trim()) {
          setError("Paste an image or Drive link first.");
          return;
        }
        body = { productName, pastedUrl: url.trim() };
      } else {
        if (files.length === 0) {
          setError("Select an image file.");
          return;
        }
        if (single) {
          const f = files[0];
          body = {
            productName,
            file: {
              fileName: f.name,
              fileData: await readAsBase64(f),
              mimeType: f.type,
            },
          };
        } else {
          const encoded = await Promise.all(
            files.map(async (f) => ({
              fileName: f.name,
              fileData: await readAsBase64(f),
              mimeType: f.type,
            })),
          );
          body = { productName, files: encoded };
        }
      }

      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to send");

      if (single && data.imageUrl) {
        setSavedUrl(data.imageUrl);
        onUploaded?.(data.imageUrl);
      }

      setSuccess(true);
      setUrl("");
      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  const displayUrl = savedUrl ?? existingUrl;

  return (
    <fieldset className="form-fieldset grid gap-half">
      <div className="row ai-cen gap-half">
        <legend className="bold">
          Image <span className="clr-muted xsmall">(optional)</span>
        </legend>
        <button
          type="button"
          className="btn-icon btn-help"
          onClick={() => setShowHint((v) => !v)}
          aria-expanded={showHint}
          disabled={disabled}
        >
          <CircleQuestionMark aria-hidden="true" />
        </button>
      </div>
      {showHint && (
        <p className="xsmall clr-warning margin-be-half">
          {single
            ? "Upload a single image for this variant. The file is saved to Drive and the developer is notified to optimize and watermark it. Allow 1–2 business days."
            : "Upload one or more images for this product. Files are saved to Drive and the developer is notified to optimize and watermark them. Allow 1–2 business days."}
        </p>
      )}

      <div className="grid gap-half">
        {displayUrl && (
          <p className="xsmall clr-muted word-break-ba">
            Current:{" "}
            <a href={displayUrl} target="_blank" rel="noopener noreferrer">
              {displayUrl}
            </a>
          </p>
        )}

        <div className="row gap-1">
          <label className="row gap-half ai-cen bold">
            <input
              id={`img-radio-file-${sku}`}
              type="radio"
              name={`img-mode-${sku}`}
              checked={mode === "file"}
              onChange={() => handleModeChange("file")}
              disabled={disabled || submitting}
            />
            Upload {single ? "file" : "files"}
          </label>
          <label className="row gap-half ai-cen bold">
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
              aria-label="Drive link URL"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSuccess(false);
              }}
              placeholder="https://drive.google.com/…"
              disabled={disabled || submitting}
            />
            {!single && (
              <p className="xsmall clr-muted">
                Make sure the Drive file is shared with your developer.
              </p>
            )}
          </>
        ) : (
          <div className="grid gap-quarter">
            <input
              id={`img-file-${sku}`}
              className="input-file_img padding-b-half"
              ref={fileInputRef}
              type="file"
              aria-label={single ? "Select image file" : "Select image files"}
              accept="image/*"
              multiple={!single}
              onChange={(e) => {
                setFiles(Array.from(e.target.files ?? []));
                setSuccess(false);
              }}
              disabled={disabled || submitting}
            />
            {files.length > 0 && (
              <ul className="img-file-list small clr-muted" role="list">
                {files.map((f, i) => (
                  <li
                    key={i}
                    className="row gap-half ai-cen jc-sb padding-quarter"
                  >
                    <span>
                      {sku}
                      {files.length > 1 ? `-${i + 1}` : ""}.
                      {f.name.split(".").pop()}
                    </span>
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

        {isPending && (
          <p role="alert" className="status-line" data-tone="warning">
            {single
              ? "Save the image or clear it before saving changes."
              : files.length > 1
                ? `${files.length} images selected — send them for processing or remove files before saving.`
                : "Send the image for processing or clear it before saving changes."}
          </p>
        )}

        {success ? (
          <p role="status" className="status-line" data-tone="success">
            {single
              ? "Image saved."
              : files.length > 1
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
                  <span className="render-loader">Saving…</span>
                ) : (
                  <>
                    <Upload aria-hidden="true" />
                    <span>{single ? "Save image" : "Send for processing"}</span>
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
                  <span>
                    {!single && files.length > 1 ? "Clear all" : "Clear"}
                  </span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
}

import { CircleQuestionMark, X, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
import type { NewProductFields, RefData } from "~/types/catalog";
import { isSalePriceValid } from "~/utils/priceUtils";
import FormGroupRef from "./FormGroupRef";
import RichTextEditor from "./RichTextEditor";

interface DialogCreateProductProps {
  onClose: () => void;
  onCreated: (sku: string) => void;
  onPending: () => void;
  onFailed: (error: string) => void;
}

interface FormState {
  category: string;
  subcategory: string;
  basePriceDollars: string;
  salePriceDollars: string;
  publishedStatus: string;
  weightOz: string;
  displayName: string;
  design: string;
  styleModifier: string;
  dimensionsWidth: string;
  dimensionsHeight: string;
  dimensionsDepth: string;
  primaryDescription: string;
  shortDescription: string;
}

const empty: FormState = {
  category: "",
  subcategory: "",
  basePriceDollars: "",
  salePriceDollars: "",
  publishedStatus: "draft",
  weightOz: "",
  displayName: "",
  design: "",
  styleModifier: "",
  dimensionsWidth: "",
  dimensionsHeight: "",
  dimensionsDepth: "",
  primaryDescription: "",
  shortDescription: "",
};

export default function DialogCreateProduct({
  onClose,
  onCreated,
  onPending,
  onFailed,
}: DialogCreateProductProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [refData, setRefData] = useState<RefData | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [shortDescOverLimit, setShortDescOverLimit] = useState(false);
  const [imageMode, setImageMode] = useState<"file" | "url">("file");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const imageFileRef = useRef<HTMLInputElement>(null);
  const [showCatHelp, setShowCatHelp] = useState(false);
  const [showPrimaryDescHelp, setShowPrimaryDescHelp] = useState(false);
  const [showShortDescHelp, setShowShortDescHelp] = useState(false);
  const [subcatFormOpen, setSubcatFormOpen] = useState(false);

  useEffect(() => {
    ref.current?.showModal();

    fetch("/api/catalog/get_meta")
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load ref data");
        setRefData(data as RefData);
      })
      .catch((err) => setMetaError(err.message));
  }, []);

  const set =
    (field: keyof FormState) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const setNumeric =
    (field: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const stripped = raw.replace(/^0+(?=\d)/, "");
      setForm((prev) => ({ ...prev, [field]: stripped }));
    };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    const fields: NewProductFields = {
      category: form.category,
      subcategory: form.subcategory,
      basePriceDollars: form.basePriceDollars,
      salePriceDollars: form.salePriceDollars || undefined,
      publishedStatus: form.publishedStatus,
      weightOz: form.weightOz,
      displayName: form.displayName || undefined,
      design: form.design || undefined,
      styleModifier: form.styleModifier || undefined,
      dimensionsWidth: form.dimensionsWidth || undefined,
      dimensionsHeight: form.dimensionsHeight || undefined,
      dimensionsDepth: form.dimensionsDepth || undefined,
      primaryDescription: form.primaryDescription || undefined,
      shortDescription: form.shortDescription || undefined,
    };

    // Capture image data before closing — we'll need it after the SKU arrives
    const capturedFile = imageFile;
    const capturedUrl = imageUrl.trim();
    const capturedName = form.displayName || form.design || "";

    // Close the dialog immediately — the sheet formulas can take up to 3
    // minutes to settle. The fetch runs in the background; the parent shows
    // a pending indicator and a success/error toast when it resolves.
    onPending();

    fetch("/api/catalog/create_product", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
      credentials: "include",
    })
      .then((res) => res.json())
      .then(async (data) => {
        if (!data.ok) throw new Error(data.error || "Failed to create product");
        const sku: string = data.sku;

        // Upload image if the user selected/pasted one — best-effort, non-fatal
        if (capturedFile || capturedUrl) {
          try {
            let imgBody: Record<string, unknown>;
            if (capturedFile) {
              imgBody = {
                productName: capturedName || sku,
                file: {
                  fileName: capturedFile.name,
                  fileData: await readAsBase64(capturedFile),
                  mimeType: capturedFile.type,
                },
              };
            } else {
              imgBody = {
                productName: capturedName || sku,
                pastedUrl: capturedUrl,
              };
            }
            await fetch(
              `/api/catalog/product/${encodeURIComponent(sku)}/image`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(imgBody),
              },
            );
          } catch {
            // Image failure is non-fatal — product was created, image can be added via Edit
          }
        }

        // Publish immediately if the user chose "publish" — skips the extra
        // manual sync step on the Products page. Best-effort: the product
        // row already exists either way, so a failure here just leaves it
        // as an unsynced draft the user can push normally from there.
        if (form.publishedStatus === "publish" && data.productId) {
          try {
            await fetch("/api/catalog/sync_to_site", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                mode: "selected",
                productIds: [data.productId],
                publish: true,
              }),
            });
          } catch {
            // Non-fatal — product was created, sync can be retried from Products page
          }
        }

        onCreated(sku);
      })
      .catch((err: unknown) => {
        onFailed(
          err instanceof Error ? err.message : "Failed to create product",
        );
      });
  };

  const salePriceValid = isSalePriceValid(
    form.basePriceDollars,
    form.salePriceDollars,
  );

  const canSubmit =
    form.category &&
    form.subcategory &&
    form.basePriceDollars &&
    form.weightOz &&
    !shortDescOverLimit &&
    salePriceValid;

  return (
    <dialog ref={ref} className="dialog-product card" onCancel={onClose}>
      <div className="grid gap-1half dialog-inner dialog-product-inner">
        <div className="row jc-sb ai-cen">
          <h2>New Product</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>

        {metaError && (
          <p role="alert" className="status-line" data-tone="error">
            {metaError}
          </p>
        )}

        {!refData && !metaError && (
          <p role="status" className="status-line" data-tone="loading">
            Loading options…
          </p>
        )}

        {refData && (
          <form
            className="form-product_create grid gap-1"
            onSubmit={handleSubmit}
          >
            <FormGroupRef
              label="Category"
              htmlFor="cp-category"
              hasRequired={true}
              labelActions={
                <button
                  type="button"
                  className="btn-icon btn-help"
                  onClick={() => setShowCatHelp((v) => !v)}
                  aria-expanded={showCatHelp}
                  aria-controls="cp-category-help"
                >
                  <CircleQuestionMark aria-hidden="true" />
                </button>
              }
              hint={
                <>
                  {showCatHelp && (
                    <p id="cp-category-help" className="xsmall clr-warning">
                      Once a product is published to the website, its category
                      cannot be changed as the sku relies on category.
                    </p>
                  )}
                  {subcatFormOpen && (
                    <p className="ref-add__hint clr-muted xsmall">
                      Close the subcategory form to change category
                    </p>
                  )}
                </>
              }
              refType="category"
              existingValues={refData.categories.map((c) => c.value)}
              existingCodes={refData.categories.map((c) => c.code)}
              onAdded={({ value, code, wooId }) => {
                setRefData((prev) =>
                  prev
                    ? {
                        ...prev,
                        categories: [
                          ...prev.categories,
                          { value, code, wooId: wooId ?? null },
                        ],
                      }
                    : prev,
                );
                setForm((f) => ({ ...f, category: value }));
              }}
              disabled={subcatFormOpen}
            >
              <select
                id="cp-category"
                value={form.category}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    category: e.target.value,
                    subcategory: "",
                  }))
                }
                required
                disabled={subcatFormOpen}
              >
                <option value="">— select —</option>
                {[...refData.categories]
                  .filter((c) => c.wooId !== 112)
                  .sort((a, b) => a.value.localeCompare(b.value))
                  .map((c) => (
                    <option key={c.code} value={c.value}>
                      {c.value.charAt(0).toUpperCase() + c.value.slice(1)} (
                      {c.code})
                    </option>
                  ))}
              </select>
            </FormGroupRef>

            <FormGroupRef
              label="Subcategory"
              htmlFor="cp-subcategory"
              hasRequired={true}
              refType="subcategory"
              existingValues={refData.subcategories.map((s) => s.value)}
              existingCodes={refData.subcategories.map((s) => s.code)}
              parentWooId={
                refData.categories.find((c) => c.value === form.category)
                  ?.wooId ?? null
              }
              parentCode={
                refData.categories.find((c) => c.value === form.category)
                  ?.code ?? null
              }
              parentDisplayName={form.category || undefined}
              onExpandedChange={setSubcatFormOpen}
              onAdded={({ value, code, wooId, label, parentCode }) => {
                setRefData((prev) =>
                  prev
                    ? {
                        ...prev,
                        subcategories: [
                          ...prev.subcategories,
                          {
                            value,
                            code,
                            label: label ?? value,
                            wooId: wooId ?? null,
                            parentCode: parentCode ?? "",
                          },
                        ],
                      }
                    : prev,
                );
                setForm((f) => ({ ...f, subcategory: value }));
              }}
            >
              <select
                id="cp-subcategory"
                value={form.subcategory}
                onChange={set("subcategory")}
                required
                disabled={!form.category}
              >
                <option value="">— select —</option>
                {[...refData.subcategories]
                  .filter((s) => {
                    const selectedCat = refData.categories.find(
                      (c) => c.value === form.category,
                    );
                    return !!selectedCat && s.parentCode === selectedCat.code;
                  })
                  .sort((a, b) =>
                    (a.label ?? a.value).localeCompare(b.label ?? b.value),
                  )
                  .map((s) => (
                    <option key={s.code} value={s.value}>
                      {s.label} ({s.code})
                    </option>
                  ))}
              </select>
            </FormGroupRef>

            <div className="row gap-1 fw-wrap ai-end">
              <div className="form-group flex-1">
                <label className="bold" htmlFor="cp-price">
                  Base Price ($)
                </label>
                <input
                  id="cp-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.basePriceDollars}
                  onChange={setNumeric("basePriceDollars")}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) =>
                    (e.key === "-" || e.key === "e") && e.preventDefault()
                  }
                  placeholder="0.00"
                  required
                />
              </div>

              <div className="form-group flex-1">
                <label htmlFor="cp-sale-price" className="bold">
                  Sale Price ($){" "}
                  <span className="muted xsmall">(optional)</span>
                </label>
                <input
                  id="cp-sale-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.salePriceDollars}
                  onChange={setNumeric("salePriceDollars")}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) =>
                    (e.key === "-" || e.key === "e") && e.preventDefault()
                  }
                  placeholder="0.00"
                />
                {!salePriceValid && (
                  <p role="alert" className="xsmall clr-danger">
                    Sale price must be less than base price.
                  </p>
                )}
              </div>

              <div className="form-group flex-1">
                <label className="bold" htmlFor="cp-weight">
                  Weight (oz)
                </label>
                <input
                  id="cp-weight"
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.weightOz}
                  onChange={setNumeric("weightOz")}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) =>
                    (e.key === "-" || e.key === "e") && e.preventDefault()
                  }
                  placeholder="0.0"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="bold" htmlFor="cp-published-status">
                Published status{" "}
                <span className="clr-muted xsmall">
                  (optional — defaults to draft)
                </span>
              </label>
              <select
                id="cp-published-status"
                value={form.publishedStatus}
                onChange={set("publishedStatus")}
              >
                <option value="draft">Draft</option>
                <option value="publish">Published</option>
                <option value="private">Private</option>
              </select>
            </div>

            <div className="form-group">
              <label className="bold" htmlFor="cp-display-name">
                Display Name{" "}
                <span className="clr-muted xsmall">(optional)</span>
              </label>
              <input
                id="cp-display-name"
                type="text"
                value={form.displayName}
                onChange={set("displayName")}
                placeholder="e.g. Classic Logo T-Shirt"
              />
            </div>

            <FormGroupRef
              label={
                <>
                  Design <span className="clr-muted xsmall">(optional)</span>
                </>
              }
              htmlFor="cp-design"
              refType="graphic"
              existingValues={refData.graphics}
              existingCodes={[]}
              onAdded={({ value }) => {
                setRefData((prev) =>
                  prev
                    ? { ...prev, graphics: [...prev.graphics, value] }
                    : prev,
                );
                setForm((f) => ({ ...f, design: value }));
              }}
            >
              <select
                id="cp-design"
                value={form.design}
                onChange={set("design")}
              >
                <option value="">— none —</option>
                {[...refData.graphics]
                  .sort((a, b) => a.localeCompare(b))
                  .map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
              </select>
            </FormGroupRef>

            <FormGroupRef
              label={
                <>
                  Style Modifier{" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </>
              }
              htmlFor="cp-style"
              refType="style"
              existingValues={refData.styles}
              existingCodes={[]}
              onAdded={({ value }) => {
                setRefData((prev) =>
                  prev ? { ...prev, styles: [...prev.styles, value] } : prev,
                );
                setForm((f) => ({ ...f, styleModifier: value }));
              }}
            >
              <select
                id="cp-style"
                value={form.styleModifier}
                onChange={set("styleModifier")}
              >
                <option value="">— none —</option>
                {[...refData.styles]
                  .sort((a, b) => a.localeCompare(b))
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </select>
            </FormGroupRef>

            <fieldset className="form-fieldset grid gap-half">
              <legend>
                Dimensions <span className="clr-muted xsmall">(optional)</span>
              </legend>
              <div className="row gap-1 fw-wrap">
                <div className="form-group flex-1">
                  <label htmlFor="cp-dim-w" className="bold">
                    Width (in)
                  </label>
                  <input
                    id="cp-dim-w"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.dimensionsWidth}
                    onChange={set("dimensionsWidth")}
                  />
                </div>
                <div className="form-group flex-1">
                  <label htmlFor="cp-dim-h" className="bold">
                    Height (in)
                  </label>
                  <input
                    id="cp-dim-h"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.dimensionsHeight}
                    onChange={set("dimensionsHeight")}
                  />
                </div>
                <div className="form-group flex-1">
                  <label htmlFor="cp-dim-d" className="bold">
                    Depth (in)
                  </label>
                  <input
                    id="cp-dim-d"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.dimensionsDepth}
                    onChange={set("dimensionsDepth")}
                  />
                </div>
              </div>
            </fieldset>

            <div className="form-group">
              <div className="row ai-cen gap-half">
                <label className="bold">
                  Primary description{" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </label>
                <button
                  type="button"
                  className="btn-icon btn-help"
                  onClick={() => setShowPrimaryDescHelp((v) => !v)}
                  aria-expanded={showPrimaryDescHelp}
                  aria-controls="cp-primary-desc-help"
                >
                  <CircleQuestionMark aria-hidden="true" />
                </button>
              </div>
              {showPrimaryDescHelp && (
                <p id="cp-primary-desc-help" className="xsmall clr-warning">
                  The full product description shown on the product page —
                  materials, care, sizing notes, story, etc. This is the main
                  body of content.
                </p>
              )}
              <RichTextEditor
                value={form.primaryDescription}
                onChange={(html) =>
                  setForm((prev) => ({ ...prev, primaryDescription: html }))
                }
                placeholder="Full product description…"
                variant="full"
              />
            </div>

            <div className="form-group">
              <div className="row ai-cen gap-half">
                <label className="bold">
                  Short description{" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </label>
                <button
                  type="button"
                  className="btn-icon btn-help"
                  onClick={() => setShowShortDescHelp((v) => !v)}
                  aria-expanded={showShortDescHelp}
                  aria-controls="cp-short-desc-help"
                >
                  <CircleQuestionMark aria-hidden="true" />
                </button>
              </div>
              {showShortDescHelp && (
                <p id="cp-short-desc-help" className="xsmall clr-warning">
                  A 1–2 sentence summary shown in product listings and previews.
                  Keep it brief — this is not where the full story goes. Max 100
                  characters.
                </p>
              )}
              <RichTextEditor
                value={form.shortDescription}
                onChange={(html) =>
                  setForm((prev) => ({ ...prev, shortDescription: html }))
                }
                onOverLimit={setShortDescOverLimit}
                placeholder="One or two sentences shown in the shop listing…"
                variant="simple"
              />
            </div>

            <fieldset className="form-fieldset">
              <legend className="bold">
                Image <span className="clr-muted xsmall">(optional)</span>
              </legend>
              <div className="grid gap-half">
                <div className="row gap-1">
                  <label className="row gap-half ai-cen bold">
                    <input
                      type="radio"
                      name="cp-img-mode"
                      checked={imageMode === "file"}
                      onChange={() => {
                        setImageMode("file");
                        setImageUrl("");
                        setImageFile(null);
                        if (imageFileRef.current)
                          imageFileRef.current.value = "";
                      }}
                    />
                    Upload file
                  </label>
                  <label className="row gap-half ai-cen bold">
                    <input
                      type="radio"
                      name="cp-img-mode"
                      checked={imageMode === "url"}
                      onChange={() => {
                        setImageMode("url");
                        setImageFile(null);
                        if (imageFileRef.current)
                          imageFileRef.current.value = "";
                      }}
                    />
                    Paste Drive link
                  </label>
                </div>
                {imageMode === "file" ? (
                  <input
                    ref={imageFileRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                  />
                ) : (
                  <input
                    type="url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://drive.google.com/…"
                  />
                )}
                {(imageFile || imageUrl.trim()) && (
                  <p className="xsmall clr-muted">
                    Image will be sent to dev for processing after the product
                    is created.
                  </p>
                )}
              </div>
            </fieldset>

            {submitError && (
              <p role="alert" className="status-line" data-tone="error">
                {submitError}
              </p>
            )}

            <div className="row gap-1 fw-wrap">
              <button
                type="submit"
                className="btn-primary row ai-cen jc-cen gap-half flex-1"
                disabled={!canSubmit}
              >
                <Plus aria-hidden="true" />
                <span>
                  {form.publishedStatus === "publish"
                    ? "Create + Publish"
                    : "Create Product"}
                </span>
              </button>
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={onClose}
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

import { Globe, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogGroup } from "~/types/catalog";
import { isSalePriceValid } from "~/utils/priceUtils";
import RichTextEditor from "./RichTextEditor";
import ImageUploadSection from "./ImageUploadSection";

interface DialogEditProductProps {
  group: CatalogGroup;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  displayName: string;
  basePriceDollars: string;
  salePriceDollars: string;
  publishedStatus: string;
  weightOz: string;
  primaryDescription: string;
  shortDescription: string;
  dimensionsWidth: string;
  dimensionsHeight: string;
  dimensionsDepth: string;
}

function initForm(group: CatalogGroup): FormState {
  return {
    displayName: group.displayName ?? "",
    basePriceDollars: (group.basePriceDollars ?? "").replace(/[^0-9.]/g, ""),
    salePriceDollars: (group.salePriceDollars ?? "").replace(/[^0-9.]/g, ""),
    publishedStatus: group.publishedStatus ?? "draft",
    weightOz: group.weightOz ?? "",
    primaryDescription: group.primaryDescription ?? "",
    shortDescription: group.shortDescription ?? "",
    dimensionsWidth: group.dimensionsWidth ?? "",
    dimensionsHeight: group.dimensionsHeight ?? "",
    dimensionsDepth: group.dimensionsDepth ?? "",
  };
}

export default function DialogEditProduct({
  group,
  onClose,
  onSaved,
}: DialogEditProductProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const original = useRef<FormState>(initForm(group));
  const [form, setForm] = useState<FormState>(original.current);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [shortDescOverLimit, setShortDescOverLimit] = useState(false);
  const [imageIsPending, setImageIsPending] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const set =
    (field: keyof FormState) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const isDirty = (Object.keys(form) as Array<keyof FormState>).some(
    (k) => form[k] !== original.current[k],
  );

  const validate = (): string | null => {
    const orig = original.current;
    if (
      form.displayName !== orig.displayName &&
      orig.displayName &&
      !form.displayName.trim()
    )
      return "Display name cannot be cleared once set";
    if (
      form.basePriceDollars !== orig.basePriceDollars &&
      !form.basePriceDollars.trim()
    )
      return "Base price cannot be cleared";
    if (form.weightOz !== orig.weightOz && !form.weightOz.trim())
      return "Weight cannot be cleared";
    if (!isSalePriceValid(form.basePriceDollars, form.salePriceDollars))
      return "Sale price must be less than base price";
    return null;
  };

  const buildPayload = () => {
    const orig = original.current;
    const payload: Record<string, string> = {};
    if (form.displayName !== orig.displayName)
      payload.displayName = form.displayName.trim();
    if (form.basePriceDollars !== orig.basePriceDollars)
      payload.basePriceDollars = form.basePriceDollars.trim();
    if (form.salePriceDollars !== orig.salePriceDollars)
      payload.salePriceDollars = form.salePriceDollars.trim();
    if (form.publishedStatus !== orig.publishedStatus)
      payload.publishedStatus = form.publishedStatus;
    if (form.weightOz !== orig.weightOz)
      payload.weightOz = form.weightOz.trim();
    if (form.primaryDescription !== orig.primaryDescription)
      payload.primaryDescription = form.primaryDescription.trim();
    if (form.shortDescription !== orig.shortDescription)
      payload.shortDescription = form.shortDescription.trim();
    if (form.dimensionsWidth !== orig.dimensionsWidth)
      payload.dimensionsWidth = form.dimensionsWidth.trim();
    if (form.dimensionsHeight !== orig.dimensionsHeight)
      payload.dimensionsHeight = form.dimensionsHeight.trim();
    if (form.dimensionsDepth !== orig.dimensionsDepth)
      payload.dimensionsDepth = form.dimensionsDepth.trim();
    return payload;
  };

  const saveToSheet = async (): Promise<void> => {
    const res = await fetch(
      `/api/catalog/product/${encodeURIComponent(group.sku)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildPayload()),
      },
    );
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Failed to update product");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return;
    const err = validate();
    if (err) {
      setSubmitError(err);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await saveToSheet();
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAndSync = async () => {
    if (!isDirty && !group.wooId) return;
    const err = isDirty ? validate() : null;
    if (err) {
      setSubmitError(err);
      return;
    }
    setSyncing(true);
    setSubmitError(null);
    try {
      if (isDirty) await saveToSheet();
      const res = await fetch("/api/catalog/sync_to_site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          mode: "selected",
          productIds: [group.productId],
          publish: group.publishedStatus !== "draft",
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Sync failed");
      const result: { status: string; error?: string } | undefined =
        data.results?.[0];
      if (result?.status === "failed")
        throw new Error(result.error || "Sync failed");
      if (result?.status === "sku_collision_trashed")
        throw new Error(
          result.error || "A trashed WooCommerce product exists with this SKU",
        );
      onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Save & sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog-edit-product card" onCancel={onClose}>
      <div className="grid gap-1half dialog-inner">
        <div className="row jc-sb ai-cen">
          <hgroup>
            <h2>Edit product</h2>
            <p className="small clr-muted">{group.sku}</p>
          </hgroup>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <form className="grid gap-1" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="ep-display-name" className="bold">
              Display name <span className="clr-muted xsmall">(optional)</span>
            </label>
            <input
              id="ep-display-name"
              type="text"
              value={form.displayName}
              onChange={set("displayName")}
              placeholder={group.productName}
              disabled={submitting}
            />
          </div>

          <div className="row gap-1 fw-wrap ai-end">
            <div className="form-group flex-1">
              <label htmlFor="ep-price" className="bold">
                Base price ($)
              </label>
              <input
                id="ep-price"
                type="number"
                min="0"
                step="0.01"
                value={form.basePriceDollars}
                onChange={set("basePriceDollars")}
                onKeyDown={(e) =>
                  (e.key === "-" || e.key === "e") && e.preventDefault()
                }
                required
                disabled={submitting}
              />
            </div>
            <div className="form-group flex-1">
              <label htmlFor="ep-sale-price" className="bold">
                Sale price ($){" "}
                <span className="clr-muted xsmall">(optional)</span>
              </label>
              <input
                id="ep-sale-price"
                type="number"
                min="0"
                step="0.01"
                value={form.salePriceDollars}
                onChange={set("salePriceDollars")}
                onKeyDown={(e) =>
                  (e.key === "-" || e.key === "e") && e.preventDefault()
                }
                disabled={submitting}
              />
              {!isSalePriceValid(
                form.basePriceDollars,
                form.salePriceDollars,
              ) && (
                <p role="alert" className="xsmall clr-danger">
                  Sale price must be less than base price.
                </p>
              )}
            </div>
            <div className="form-group flex-1">
              <label htmlFor="ep-weight" className="bold">
                Weight (oz)
              </label>
              <input
                id="ep-weight"
                type="number"
                min="0"
                step="0.001"
                value={form.weightOz}
                onChange={set("weightOz")}
                onKeyDown={(e) =>
                  (e.key === "-" || e.key === "e") && e.preventDefault()
                }
                required
                disabled={submitting}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="ep-published-status" className="bold">
              Published status
            </label>
            <select
              id="ep-published-status"
              value={form.publishedStatus}
              onChange={set("publishedStatus")}
              disabled={submitting}
            >
              <option value="draft">Draft</option>
              <option value="publish">Published</option>
              <option value="private">Private</option>
            </select>
          </div>

          <fieldset className="form-fieldset grid gap-half">
            <legend className="bold">Dimensions (optional)</legend>
            <div className="row gap-1 fw-wrap ai-end">
              <div className="form-group flex-1">
                <label htmlFor="ep-dim-w" className="bold">
                  Width (in)
                </label>
                <input
                  id="ep-dim-w"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.dimensionsWidth}
                  onChange={set("dimensionsWidth")}
                  disabled={submitting}
                />
              </div>
              <div className="form-group flex-1">
                <label htmlFor="ep-dim-h" className="bold">
                  Height (in)
                </label>
                <input
                  id="ep-dim-h"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.dimensionsHeight}
                  onChange={set("dimensionsHeight")}
                  disabled={submitting}
                />
              </div>
              <div className="form-group flex-1">
                <label htmlFor="ep-dim-d" className="bold">
                  Depth (in)
                </label>
                <input
                  id="ep-dim-d"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.dimensionsDepth}
                  onChange={set("dimensionsDepth")}
                  disabled={submitting}
                />
              </div>
            </div>
          </fieldset>

          <div className="form-group">
            <label className="bold">
              Primary description{" "}
              <span className="clr-muted xsmall">(optional)</span>
            </label>
            <RichTextEditor
              value={form.primaryDescription}
              onChange={(html) =>
                setForm((prev) => ({ ...prev, primaryDescription: html }))
              }
              disabled={submitting}
              placeholder="Full product description…"
              variant="full"
            />
          </div>

          <div className="form-group">
            <label className="bold">
              Short description{" "}
              <span className="clr-muted xsmall">(optional)</span>
            </label>
            <RichTextEditor
              value={form.shortDescription}
              onChange={(html) =>
                setForm((prev) => ({ ...prev, shortDescription: html }))
              }
              onOverLimit={setShortDescOverLimit}
              disabled={submitting}
              placeholder="One or two sentences shown in the shop listing…"
              variant="simple"
            />
          </div>

          <ImageUploadSection
            sku={group.sku}
            productName={group.displayName}
            disabled={submitting}
            onPendingChange={setImageIsPending}
          />

          {submitError && (
            <p role="alert" className="status-line" data-tone="error">
              {submitError}
            </p>
          )}

          <div className="row gap-half fw-wrap">
            <button
              type="submit"
              className="btn-primary row gap-half jc-cen ai-cen flex-1"
              disabled={
                !isDirty ||
                submitting ||
                syncing ||
                shortDescOverLimit ||
                imageIsPending
              }
            >
              {submitting ? (
                <span className="render-loader">Saving…</span>
              ) : (
                <>
                  <Save aria-hidden="true" />
                  <span>Save</span>
                </>
              )}
            </button>
            {group.wooId && (
              <button
                type="button"
                className="btn-secondary row gap-half jc-cen ai-cen flex-1"
                onClick={handleSaveAndSync}
                disabled={
                  !isDirty ||
                  submitting ||
                  syncing ||
                  shortDescOverLimit ||
                  imageIsPending
                }
              >
                {syncing ? (
                  <span className="render-loader">Syncing…</span>
                ) : (
                  <>
                    <Globe aria-hidden="true" />
                    <span>Save &amp; Sync</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary flex-1"
              onClick={onClose}
              disabled={submitting || syncing}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

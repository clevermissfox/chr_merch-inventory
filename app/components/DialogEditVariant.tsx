import { CircleQuestionMark, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogGroup, CatalogRow } from "~/types/catalog";
import ImageUploadSection from "./ImageUploadSection";
import RichTextEditor from "./RichTextEditor";

interface DialogEditVariantProps {
  row: CatalogRow;
  group: CatalogGroup;
  onClose: () => void;
  onSaved: () => Promise<void>;
}

interface FormState {
  priceVariant: string;
  salePriceVariant: string;
  weightOzVariant: string;
  descriptionVariant: string;
}

function initForm(row: CatalogRow): FormState {
  return {
    priceVariant: (row.priceVariant ?? "").replace(/[^0-9.]/g, ""),
    salePriceVariant: (row.salePriceVariant ?? "").replace(/[^0-9.]/g, ""),
    weightOzVariant: row.weightOzVariant ?? "",
    descriptionVariant: row.descriptionVariant ?? "",
  };
}

export default function DialogEditVariant({
  row,
  group,
  onClose,
  onSaved,
}: DialogEditVariantProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const original = useRef<FormState>(initForm(row));
  const [form, setForm] = useState<FormState>(original.current);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showPriceHelp, setShowPriceHelp] = useState(false);
  const [showWeightHelp, setShowWeightHelp] = useState(false);
  const [descOverLimit, setDescOverLimit] = useState(false);
  const [imageIsPending, setImageIsPending] = useState(false);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const set =
    (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const isDirty = (Object.keys(form) as Array<keyof FormState>).some(
    (k) => form[k] !== original.current[k],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const orig = original.current;
      const payload: Record<string, string> = {};
      if (form.priceVariant !== orig.priceVariant)
        payload.priceVariant = form.priceVariant.trim();
      if (form.salePriceVariant !== orig.salePriceVariant)
        payload.salePriceVariant = form.salePriceVariant.trim();
      if (form.weightOzVariant !== orig.weightOzVariant)
        payload.weightOzVariant = form.weightOzVariant.trim();
      if (form.descriptionVariant !== orig.descriptionVariant)
        payload.descriptionVariant = form.descriptionVariant.trim();

      const res = await fetch(
        `/api/catalog/variant/${encodeURIComponent(row.sku)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to update variant");
      await onSaved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Save failed");
      setSubmitting(false);
    }
  };

  const basePriceDollars = (group.basePriceDollars ?? "").replace(
    /[^0-9.]/g,
    "",
  );

  return (
    <dialog
      ref={ref}
      className="dialog dialog-edit-variant card"
      onCancel={onClose}
    >
      <div className="grid gap-1half dialog-inner">
        <div className="row jc-sb ai-cen">
          <hgroup>
            <h2>Edit variant</h2>
            <p className="xsmall clr-muted">{row.sku}</p>
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

        <dl className="product-meta row fw-wrap">
          <div>
            <dt>Product</dt>
            <dd>{group.displayName}</dd>
          </div>
          {row.label && (
            <div>
              <dt>Variant</dt>
              <dd>{row.label}</dd>
            </div>
          )}
        </dl>

        <form className="grid gap-1" onSubmit={handleSubmit}>
          <div className="row gap-1 ai-end fw-wrap">
            <div className="form-group flex-1">
              <div className="row ai-cen gap-half">
                <label htmlFor="ev-price" className="bold">
                  Price override ($){" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </label>
                <button
                  type="button"
                  className="btn-icon btn-help"
                  onClick={() => setShowPriceHelp((v) => !v)}
                  aria-expanded={showPriceHelp}
                  aria-controls="ev-price-help"
                >
                  <CircleQuestionMark aria-hidden="true" />
                </button>
              </div>
              {showPriceHelp && (
                <p id="ev-price-help" className="xsmall clr-warning">
                  This value <strong>overrides</strong> the base price. Leave
                  blank to use the product's base price ($
                  {basePriceDollars || "—"}).
                </p>
              )}
              <input
                id="ev-price"
                type="number"
                min="0"
                step="0.01"
                value={form.priceVariant}
                onChange={set("priceVariant")}
                onKeyDown={(e) =>
                  (e.key === "-" || e.key === "e") && e.preventDefault()
                }
                placeholder={basePriceDollars || "0.00"}
                disabled={submitting}
              />
            </div>
            <div className="form-group flex-1">
              <label htmlFor="ev-sale-price" className="bold">
                Sale price override ($){" "}
                <span className="clr-muted xsmall">(optional)</span>
              </label>

              <input
                id="ev-sale-price"
                type="number"
                min="0"
                step="0.01"
                value={form.salePriceVariant}
                onChange={set("salePriceVariant")}
                onKeyDown={(e) =>
                  (e.key === "-" || e.key === "e") && e.preventDefault()
                }
                placeholder={
                  group.salePriceDollars?.replace(/[^0-9.]/g, "") || "0.00"
                }
                disabled={submitting}
              />
              {group.salePriceDollars && (
                <p className="xsmall clr-muted">
                  Product sale price: $
                  {group.salePriceDollars.replace(/[^0-9.]/g, "")}. Leave blank
                  to inherit.
                </p>
              )}
            </div>
            <div className="form-group flex-1">
              <div className="row ai-cen gap-half">
                <label htmlFor="ev-weight" className="bold">
                  Weight override (oz){" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </label>
                <button
                  type="button"
                  className="btn-icon btn-help"
                  onClick={() => setShowWeightHelp((v) => !v)}
                  aria-expanded={showWeightHelp}
                  aria-controls="ev-weight-help"
                >
                  <CircleQuestionMark aria-hidden="true" />
                </button>
              </div>
              {showWeightHelp && group.weightOz && (
                <p id="ev-weight-help" className="xsmall clr-warning">
                  This value <strong>overrides</strong> the base weight. Leave
                  blank to use the product's base weight ({group.weightOz}oz).
                </p>
              )}
              <input
                id="ev-weight"
                type="number"
                min="0"
                step="0.001"
                value={form.weightOzVariant}
                onChange={set("weightOzVariant")}
                onKeyDown={(e) =>
                  (e.key === "-" || e.key === "e") && e.preventDefault()
                }
                placeholder={group.weightOz ?? "0.0"}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="bold">
              Description <span className="clr-muted xsmall">(optional)</span>
            </label>
            <RichTextEditor
              value={form.descriptionVariant}
              onChange={(html) =>
                setForm((prev) => ({ ...prev, descriptionVariant: html }))
              }
              onOverLimit={setDescOverLimit}
              disabled={submitting}
              placeholder="What's unique about this variant…"
              variant="simple"
              maxChars={150}
            />
          </div>

          <ImageUploadSection
            sku={row.sku}
            productName={`${group.displayName} — ${row.label ?? row.sku}`}
            disabled={submitting}
            single
            existingUrl={row.imageVariant ?? undefined}
            endpoint={`/api/catalog/variant/${encodeURIComponent(row.sku)}/image`}
            onPendingChange={setImageIsPending}
          />

          <p className="xsmall">
            Note: Cannot change color, graphic, size, or dimensions as it would
            change the SKU. Delete and recreate the variant if those need to
            change.
          </p>

          {submitError && (
            <p role="alert" className="status-line" data-tone="error">
              {submitError}
            </p>
          )}

          <div className="row gap-half fw-wrap">
            <button
              type="submit"
              className="btn-primary row gap-half ai-cen"
              disabled={!isDirty || submitting || descOverLimit || imageIsPending}
            >
              {submitting ? (
                <>
                  <span className="render-loader">Saving…</span>
                </>
              ) : (
                <>
                  <Save aria-hidden="true" />
                  <span>Save changes</span>
                </>
              )}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}

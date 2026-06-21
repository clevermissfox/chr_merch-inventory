import { useEffect, useRef, useState } from "react";
import type { NewProductFields, RefData } from "~/types/catalog";

interface CreateProductDialogProps {
  onClose: () => void;
  onCreated: (sku: string) => void;
}

interface FormState {
  category: string;
  subcategory: string;
  basePriceDollars: string;
  weightOz: string;
  displayName: string;
  design: string;
  styleModifier: string;
}

const empty: FormState = {
  category: "",
  subcategory: "",
  basePriceDollars: "",
  weightOz: "",
  displayName: "",
  design: "",
  styleModifier: "",
};

export default function CreateProductDialog({
  onClose,
  onCreated,
}: CreateProductDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [refData, setRefData] = useState<RefData | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showCatHelp, setShowCatHelp] = useState(false);

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
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    try {
      const fields: NewProductFields = {
        category: form.category,
        subcategory: form.subcategory,
        basePriceDollars: form.basePriceDollars,
        weightOz: form.weightOz,
        displayName: form.displayName || undefined,
        design: form.design || undefined,
        styleModifier: form.styleModifier || undefined,
      };

      const res = await fetch("/api/catalog/create_product", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
        credentials: "include",
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create product");

      onCreated(data.sku);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  };

  const canSubmit =
    form.category && form.subcategory && form.basePriceDollars && form.weightOz;

  return (
    <dialog ref={ref} className="dialog dialog-product" onCancel={onClose}>
      <div className="card grid gap-1half">
        <div className="row jc-sb ai-cen">
          <h2>New Product</h2>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>

        {metaError && (
          <div className="status-line" data-tone="error">
            {metaError}
          </div>
        )}

        {!refData && !metaError && (
          <div className="status-line">
            Loading options… <span className="loader" />
          </div>
        )}

        {refData && (
          <form
            className="form-product_create grid gap-1"
            onSubmit={handleSubmit}
          >
            <div className="form-group">
              <div className="row ai-cen gap-half">
                <label className="bold" htmlFor="cp-category">
                  Category
                </label>
                <button
                  type="button"
                  className="btn-icon btn-help"
                  onClick={() => setShowCatHelp((v) => !v)}
                  aria-expanded={showCatHelp}
                  aria-controls="cp-category-help"
                >
                  ?
                </button>
              </div>
              {showCatHelp && (
                <p id="cp-category-help" className="small clr-warning">
                  Once a product is published to the website, its category
                  cannot be changed as the sku relies on category.
                </p>
              )}
              <select
                id="cp-category"
                value={form.category}
                onChange={set("category")}
                required
                disabled={submitting}
              >
                <option value="">— select —</option>
                {refData.categories.map((c) => (
                  <option key={c.code} value={c.value}>
                    {c.value} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="bold" htmlFor="cp-subcategory">
                Subcategory
              </label>
              <select
                id="cp-subcategory"
                value={form.subcategory}
                onChange={set("subcategory")}
                required
                disabled={submitting}
              >
                <option value="">— select —</option>
                {refData.subcategories.map((s) => (
                  <option key={s.code} value={s.value}>
                    {s.label} ({s.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="row gap-1 fw-wrap">
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
                  onChange={set("basePriceDollars")}
                  placeholder="0.00"
                  required
                  disabled={submitting}
                />
              </div>

              <div className="form-group flex-1">
                <label className="bold" htmlFor="cp-weight">
                  Weight (oz)
                </label>
                <input
                  id="cp-weight"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.weightOz}
                  onChange={set("weightOz")}
                  placeholder="0.0"
                  required
                  disabled={submitting}
                />
              </div>
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
                disabled={submitting}
              />
            </div>

            {refData.graphics.length > 0 && (
              <div className="form-group">
                <label className="bold" htmlFor="cp-design">
                  Design <span className="clr-muted xsmall">(optional)</span>
                </label>
                <select
                  id="cp-design"
                  value={form.design}
                  onChange={set("design")}
                  disabled={submitting}
                >
                  <option value="">— none —</option>
                  {refData.graphics.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {refData.styles.length > 0 && (
              <div className="form-group">
                <label className="bold" htmlFor="cp-style">
                  Style Modifier{" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </label>
                <select
                  id="cp-style"
                  value={form.styleModifier}
                  onChange={set("styleModifier")}
                  disabled={submitting}
                >
                  <option value="">— none —</option>
                  {refData.styles.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {submitError && (
              <div className="status-line" data-tone="error">
                {submitError}
              </div>
            )}

            <div className="row gap-1 jc-end">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary row gap-half"
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <>
                    Creating… <span className="loader" />
                  </>
                ) : (
                  <>
                    <i className="bi bi-plus-lg" aria-hidden="true" />
                    Create Product
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

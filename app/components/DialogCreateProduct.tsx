import { CircleQuestionMark, X, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { NewProductFields, RefData } from "~/types/catalog";
import RefAddNew from "./RefAddNew";

interface DialogCreateProductProps {
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

export default function DialogCreateProduct({
  onClose,
  onCreated,
}: DialogCreateProductProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [refData, setRefData] = useState<RefData | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showCatHelp, setShowCatHelp] = useState(false);
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
    <dialog ref={ref} className="dialog dialog-product card" onCancel={onClose}>
      <div className="grid gap-1half dialog-inner dialog-product-inner">
        <div className="row jc-sb ai-cen">
          <h2>New Product</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
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
                  <CircleQuestionMark aria-hidden="true" />
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
                disabled={submitting || subcatFormOpen}
              >
                <option value="">— select —</option>
                {[...refData.categories]
                  .filter((c) => c.wooId !== 112)
                  .sort((a, b) => a.value.localeCompare(b.value))
                  .map((c) => (
                    <option key={c.code} value={c.value}>
                      {c.value} ({c.code})
                    </option>
                  ))}
              </select>
              {subcatFormOpen && (
                <p className="ref-add__hint clr-muted xsmall">
                  Close the subcategory form to change category
                </p>
              )}
              <RefAddNew
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
                disabled={submitting || subcatFormOpen}
              />
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
                {[...refData.subcategories]
                  .sort((a, b) =>
                    (a.label ?? a.value).localeCompare(b.label ?? b.value),
                  )
                  .map((s) => (
                    <option key={s.code} value={s.value}>
                      {s.label} ({s.code})
                    </option>
                  ))}
              </select>
              {(() => {
                const selectedCat = refData.categories.find(
                  (c) => c.value === form.category,
                );
                return (
                  <RefAddNew
                    refType="subcategory"
                    existingValues={refData.subcategories.map((s) => s.value)}
                    existingCodes={refData.subcategories.map((s) => s.code)}
                    parentWooId={selectedCat?.wooId ?? null}
                    parentDisplayName={form.category || undefined}
                    onExpandedChange={setSubcatFormOpen}
                    onAdded={({ value, code, wooId, label }) => {
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
                                },
                              ],
                            }
                          : prev,
                      );
                      setForm((f) => ({ ...f, subcategory: value }));
                    }}
                    disabled={submitting}
                  />
                );
              })()}
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
                  onKeyDown={(e) =>
                    (e.key === "-" || e.key === "e") && e.preventDefault()
                  }
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
                  onKeyDown={(e) =>
                    (e.key === "-" || e.key === "e") && e.preventDefault()
                  }
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
                {[...refData.graphics]
                  .sort((a, b) => a.localeCompare(b))
                  .map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
              </select>
              <RefAddNew
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
                disabled={submitting}
              />
            </div>

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
                {[...refData.styles]
                  .sort((a, b) => a.localeCompare(b))
                  .map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
              </select>
              <RefAddNew
                refType="style"
                existingValues={refData.styles}
                existingCodes={[]}
                onAdded={({ value }) => {
                  setRefData((prev) =>
                    prev ? { ...prev, styles: [...prev.styles, value] } : prev,
                  );
                  setForm((f) => ({ ...f, styleModifier: value }));
                }}
                disabled={submitting}
              />
            </div>

            {submitError && (
              <p role="alert" className="status-line" data-tone="error">
                {submitError}
              </p>
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
                className="btn-primary row ai-cen gap-half"
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <>
                    <span className="loader" aria-hidden="true" />
                    <span>Creating… </span>
                  </>
                ) : (
                  <>
                    <Plus aria-hidden="true" />
                    <span>Create Product</span>
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

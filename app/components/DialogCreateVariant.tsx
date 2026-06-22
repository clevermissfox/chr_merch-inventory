import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogGroup, RefData } from "~/types/catalog";
import AddNewRef from "./AddNewRef";

interface DialogCreateVariantProps {
  group: CatalogGroup;
  onClose: () => void;
  onCreated: (skus: string[]) => void;
}

export default function DialogCreateVariant({
  group,
  onClose,
  onCreated,
}: DialogCreateVariantProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [refData, setRefData] = useState<RefData | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [selectedColors, setSelectedColors] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
  const [priceVariant, setPriceVariant] = useState("");
  const [weightOzVariant, setWeightOzVariant] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    fetch("/api/catalog/get_meta", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load ref data");
        setRefData(data as RefData);
      })
      .catch((err) => setMetaError(err.message));
  }, []);

  const toggleColor = (value: string) =>
    setSelectedColors((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });

  const toggleSize = (value: string) =>
    setSelectedSizes((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });

  const variantCount =
    selectedColors.size && selectedSizes.size
      ? selectedColors.size * selectedSizes.size
      : selectedColors.size + selectedSizes.size;

  const canSubmit = variantCount > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch(
        `/api/catalog/product/${encodeURIComponent(group.sku)}/variants`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            productId: group.productId,
            colors: Array.from(selectedColors),
            sizes: Array.from(selectedSizes),
            priceVariant: priceVariant || undefined,
            weightOzVariant: weightOzVariant || undefined,
          }),
        },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to create variants");
      onCreated(data.skus as string[]);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog dialog-variant" onCancel={onClose}>
      <div className="card grid gap-1half">
        <div className="row jc-sb ai-cen">
          <div>
            <h2>Add Variants</h2>
            <p className="small clr-muted">{group.displayName}</p>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close"
            disabled={submitting}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {metaError && (
          <div role="alert" className="status-line" data-tone="error">
            {metaError}
          </div>
        )}

        {!refData && !metaError && (
          <div role="status" className="status-line">
            Loading options… <span className="loader" />
          </div>
        )}

        {refData && (
          <form className="grid gap-1" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset">
              <legend className="bold">Colors</legend>
              <div className="check-grid">
                {refData.colors.map((c) => (
                  <label key={c.value} className="check-label">
                    <input
                      type="checkbox"
                      checked={selectedColors.has(c.value)}
                      onChange={() => toggleColor(c.value)}
                      disabled={submitting}
                    />
                    <span>{c.value}</span>
                  </label>
                ))}
              </div>
              <AddNewRef
                refType="color"
                existingValues={refData.colors.map((c) => c.value)}
                existingCodes={refData.colors.map((c) => c.code)}
                onAdded={({ value, code }) => {
                  setRefData((prev) =>
                    prev
                      ? { ...prev, colors: [...prev.colors, { value, code }] }
                      : prev,
                  );
                  setSelectedColors((prev) => new Set([...prev, value]));
                }}
                disabled={submitting}
              />
            </fieldset>

            <fieldset className="form-fieldset">
              <legend className="bold">Sizes</legend>
              <div className="check-grid">
                {refData.sizes.map((s) => (
                  <label key={s.value} className="check-label">
                    <input
                      type="checkbox"
                      checked={selectedSizes.has(s.value)}
                      onChange={() => toggleSize(s.value)}
                      disabled={submitting}
                    />
                    <span>{s.value}</span>
                  </label>
                ))}
              </div>
              <AddNewRef
                refType="size"
                existingValues={refData.sizes.map((s) => s.value)}
                existingCodes={refData.sizes.map((s) => s.code)}
                onAdded={({ value, code }) => {
                  setRefData((prev) =>
                    prev
                      ? { ...prev, sizes: [...prev.sizes, { value, code }] }
                      : prev,
                  );
                  setSelectedSizes((prev) => new Set([...prev, value]));
                }}
                disabled={submitting}
              />
            </fieldset>

            <div className="row gap-1 fw-wrap">
              <div className="form-group flex-1">
                <label htmlFor="cv-price">
                  Price Override ($){" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </label>
                <input
                  id="cv-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceVariant}
                  onChange={(e) => setPriceVariant(e.target.value)}
                  placeholder={group.basePriceDollars}
                  disabled={submitting}
                />
              </div>
              <div className="form-group flex-1">
                <label htmlFor="cv-weight">
                  Weight Override (oz){" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </label>
                <input
                  id="cv-weight"
                  type="number"
                  min="0"
                  step="0.1"
                  value={weightOzVariant}
                  onChange={(e) => setWeightOzVariant(e.target.value)}
                  placeholder={group.weightOz ?? ""}
                  disabled={submitting}
                />
              </div>
            </div>

            {canSubmit && (
              <p className="small clr-muted">
                Will create{" "}
                <strong>
                  {variantCount} variant{variantCount !== 1 ? "s" : ""}
                </strong>
                {selectedColors.size && selectedSizes.size
                  ? ` (${selectedColors.size} color${selectedColors.size !== 1 ? "s" : ""} × ${selectedSizes.size} size${selectedSizes.size !== 1 ? "s" : ""})`
                  : ""}
              </p>
            )}

            {submitError && (
              <div role="alert" className="status-line" data-tone="error">
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
                className="btn-primary row gap-half ai-cen"
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <>
                    Creating… <span className="loader" />
                  </>
                ) : (
                  `Add ${variantCount || ""} Variant${variantCount !== 1 ? "s" : ""}`
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}

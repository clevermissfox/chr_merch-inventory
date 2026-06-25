import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogGroup, RefData } from "~/types/catalog";
import { sizeRank } from "~/utils/sizeUtils";
import FormGroupRef from "./FormGroupRef";
import RefAddNew from "./RefAddNew";

function parseDimCode(code: string): [number, number] {
  const parts = code.toUpperCase().split("X");
  return [Number(parts[0]) || 0, Number(parts[1]) || 0];
}

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
  const [selectedDimensions, setSelectedDimensions] = useState<Set<string>>(
    new Set(),
  );
  const [design, setDesign] = useState("");
  const [designVariant, setDesignVariant] = useState("");
  const [weightOzVariant, setWeightOzVariant] = useState("");
  const [descriptionVariant, setDescriptionVariant] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    ref.current?.showModal();
    fetch("/api/catalog/get_meta", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || "Failed to load ref data");
        const loaded = data as RefData;
        setRefData(loaded);

        // Pre-select the dimension that matches the parent product's dimensions
        if (group.dimensionsWidth && group.dimensionsHeight) {
          const targetW = parseFloat(group.dimensionsWidth);
          const targetH = parseFloat(group.dimensionsHeight);
          const match = loaded.dimensions.find((d) => {
            const [dw, dh] = parseDimCode(d.code);
            return dw === targetW && dh === targetH;
          });
          if (match) setSelectedDimensions(new Set([match.value]));
        }
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

  const toggleDimension = (value: string) =>
    setSelectedDimensions((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });

  const axes = [
    selectedColors.size,
    selectedSizes.size,
    selectedDimensions.size,
  ].filter((n) => n > 0);
  const variantCount = axes.length > 0 ? axes.reduce((a, b) => a * b, 1) : 0;

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
            dimensions: Array.from(selectedDimensions),
            design: design || undefined,
            designVariant: designVariant || undefined,
            weightOzVariant: weightOzVariant || undefined,
            descriptionVariant: descriptionVariant || undefined,
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
    <dialog ref={ref} className="dialog dialog-variant card" onCancel={onClose}>
      <div className="grid gap-1half dialog-inner dialog-variant-inner">
        <div className="row jc-sb ai-cen">
          <hgroup>
            <h2>Add Variants</h2>
            <p className="small clr-muted">{group.displayName}</p>
          </hgroup>
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
          <form className="grid gap-1" onSubmit={handleSubmit}>
            <fieldset className="form-fieldset">
              <legend className="bold">Colors</legend>
              <div className="check-grid">
                {[...refData.colors]
                  .sort((a, b) => a.value.localeCompare(b.value))
                  .map((c) => (
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
              <RefAddNew
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
                {[...refData.sizes]
                  .sort((a, b) => {
                    const ra = sizeRank(a.value),
                      rb = sizeRank(b.value);
                    if (ra !== rb) return ra - rb;
                    return a.value.localeCompare(b.value);
                  })
                  .map((s) => (
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
              <RefAddNew
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
            {refData.dimensions.length > 0 && (
              <fieldset className="form-fieldset">
                <legend className="bold">
                  Dimensions{" "}
                  <span className="clr-muted xsmall">(optional)</span>
                </legend>
                <div className="check-grid">
                  {[...refData.dimensions]
                    .sort((a, b) => {
                      const [aw, ah] = parseDimCode(a.code);
                      const [bw, bh] = parseDimCode(b.code);
                      return aw !== bw ? aw - bw : ah - bh;
                    })
                    .map((d) => (
                      <label key={d.value} className="check-label">
                        <input
                          type="checkbox"
                          checked={selectedDimensions.has(d.value)}
                          onChange={() => toggleDimension(d.value)}
                          disabled={submitting}
                        />
                        <span>{d.value}</span>
                      </label>
                    ))}
                </div>
                <RefAddNew
                  refType="dimension"
                  existingValues={refData.dimensions.map((d) => d.value)}
                  existingCodes={refData.dimensions.map((d) => d.code)}
                  onAdded={({ value, code }) => {
                    setRefData((prev) =>
                      prev
                        ? {
                            ...prev,
                            dimensions: [...prev.dimensions, { value, code }],
                          }
                        : prev,
                    );
                    setSelectedDimensions((prev) => new Set([...prev, value]));
                  }}
                  disabled={submitting}
                />
              </fieldset>
            )}
            {refData.graphics.length > 0 && (
              <FormGroupRef
                label={
                  <>
                    Design <span className="clr-muted xsmall">(optional)</span>
                  </>
                }
                htmlFor="cv-design"
                refType="graphic"
                existingValues={refData.graphics}
                existingCodes={[]}
                onAdded={({ value }) => {
                  setRefData((prev) =>
                    prev
                      ? { ...prev, graphics: [...prev.graphics, value] }
                      : prev,
                  );
                  setDesign(value);
                }}
                disabled={submitting}
              >
                <select
                  id="cv-design"
                  value={design}
                  onChange={(e) => setDesign(e.target.value)}
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
              </FormGroupRef>
            )}
            {refData.graphicsVariants.length > 0 && (
              <FormGroupRef
                label={
                  <>
                    Design variant{" "}
                    <span className="clr-muted xsmall">(optional)</span>
                  </>
                }
                htmlFor="cv-design-variant"
                refType="graphicsVariant"
                existingValues={refData.graphicsVariants.map((g) => g.value)}
                existingCodes={refData.graphicsVariants.map((g) => g.code)}
                onAdded={({ value, code }) => {
                  setRefData((prev) =>
                    prev
                      ? {
                          ...prev,
                          graphicsVariants: [
                            ...prev.graphicsVariants,
                            { value, code },
                          ],
                        }
                      : prev,
                  );
                  setDesignVariant(value);
                }}
                disabled={submitting}
              >
                <select
                  id="cv-design-variant"
                  value={designVariant}
                  onChange={(e) => setDesignVariant(e.target.value)}
                  disabled={submitting}
                >
                  <option value="">— none —</option>
                  {[...refData.graphicsVariants]
                    .sort((a, b) => a.value.localeCompare(b.value))
                    .map((g) => (
                      <option key={g.value} value={g.value}>
                        {g.value} ({g.code})
                      </option>
                    ))}
                </select>
              </FormGroupRef>
            )}
            <div className="form-group">
              <label htmlFor="cv-weight" className="bold">
                Weight Override (oz){" "}
                <span className="clr-muted xsmall">(optional)</span>
              </label>
              <input
                id="cv-weight"
                type="number"
                min="0"
                step="0.001"
                value={weightOzVariant}
                onChange={(e) => setWeightOzVariant(e.target.value)}
                onKeyDown={(e) =>
                  (e.key === "-" || e.key === "e") && e.preventDefault()
                }
                placeholder={group.weightOz ?? ""}
                disabled={submitting}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cv-desc" className="bold">
                Bulk Variant Description{" "}
                <span className="clr-muted xsmall">(optional)</span>
              </label>
              <textarea
                id="cv-desc"
                value={descriptionVariant}
                onChange={(e) => setDescriptionVariant(e.target.value)}
                placeholder="Describe what's unique about this variant…"
                rows={3}
                disabled={submitting}
              />
            </div>
            {canSubmit && (
              <p className="small clr-muted">
                Will create{" "}
                <strong>
                  {variantCount} variant{variantCount !== 1 ? "s" : ""}
                </strong>
                {axes.length > 1 && (
                  <>
                    {" "}
                    (
                    {[
                      selectedColors.size
                        ? `${selectedColors.size} color${selectedColors.size !== 1 ? "s" : ""}`
                        : null,
                      selectedSizes.size
                        ? `${selectedSizes.size} size${selectedSizes.size !== 1 ? "s" : ""}`
                        : null,
                      selectedDimensions.size
                        ? `${selectedDimensions.size} dimension${selectedDimensions.size !== 1 ? "s" : ""}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" × ")}
                    )
                  </>
                )}
              </p>
            )}
            {submitError && (
              <p role="alert" className="status-line" data-tone="error">
                {submitError}
              </p>
            )}
            <div className="row gap-1  fw-wrap">
              <button
                type="submit"
                className="btn-primary row gap-half ai-cen"
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <>
                    <span className="render-loader">Creating… </span>
                  </>
                ) : (
                  <>
                    <Plus aria-hidden="true" />
                    <span>
                      Add {variantCount || ""} Variant
                      {variantCount > 1 ? "s" : ""}
                    </span>
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
        )}
      </div>
    </dialog>
  );
}

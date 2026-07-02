import { AlertTriangle, Globe, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CatalogGroup, RefData } from "~/types/catalog";
import { sizeRank } from "~/utils/sizeUtils";
import { variantDupeKey } from "~/utils/variantKey";
import FormGroupRef from "./FormGroupRef";
import RefAddNew from "./RefAddNew";
import RichTextEditor from "./RichTextEditor";

interface DupeSkuConflict {
  sku: string;
  existing: { dataIndex: number; label: string };
  new: { dataIndex: number; label: string };
}

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
  const [descOverLimit, setDescOverLimit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingDupes, setPendingDupes] = useState<DupeSkuConflict[] | null>(
    null,
  );
  const [resolvedSkus, setResolvedSkus] = useState<string[]>([]);
  const [resolvingDupeSku, setResolvingDupeSku] = useState<string | null>(null);
  const [dupeResolveError, setDupeResolveError] = useState<string | null>(null);

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

  // Dimensions are single-select (a variant has one physical size, unlike
  // color/size which can fan out into multiple variants at once). Clicking
  // the already-selected option clears it, since dimension is optional.
  const selectDimension = (value: string) =>
    setSelectedDimensions((prev) =>
      prev.has(value) ? new Set() : new Set([value]),
    );

  const axes = [
    selectedColors.size,
    selectedSizes.size,
    selectedDimensions.size,
  ].filter((n) => n > 0);
  const variantCount = axes.length > 0 ? axes.reduce((a, b) => a * b, 1) : 0;

  // Dimensions alone isn't enough to submit — it's auto-preselected from the
  // parent product's dimensions on open, so a dimension-only "variant" can
  // exist without the user having actually chosen anything. Require at least
  // one attribute the user picked themselves.
  const hasManualSelection =
    selectedColors.size > 0 ||
    selectedSizes.size > 0 ||
    Boolean(design) ||
    Boolean(designVariant);

  const canSubmit = variantCount > 0 && hasManualSelection && !descOverLimit;

  // Shared by both "Add Variants" and "Add & Sync" — runs the dupe checks
  // and the sheet write. Returns the created SKUs, or null if it was
  // blocked (dupe conflict, validation failure) or errored — in every
  // "null" case this already set the appropriate error/dupe state itself,
  // so callers just need to bail out without showing a second error.
  const createVariants = async (): Promise<string[] | null> => {
    setSubmitError(null);

    const existingKeys = new Set(
      group.rows.map((r) =>
        variantDupeKey({
          color: r.color,
          designVariant: r.designVariant,
          dimension: r.dimensions,
          size: r.size,
        }),
      ),
    );
    const colorOpts = selectedColors.size ? [...selectedColors] : [""];
    const sizeOpts = selectedSizes.size ? [...selectedSizes] : [""];
    const dimOpts = selectedDimensions.size ? [...selectedDimensions] : [""];
    // Two different failure modes here, worth distinguishing in the message:
    // colliding with a row that already exists on this product, vs. two of
    // the *current* selections resolving to the same SKU as each other (most
    // often because a dimension is selected alongside multiple sizes — the
    // SKU formula uses dimension over size whenever both are set, so e.g.
    // "x-large + 3x3" and "no size + 3x3" aren't actually two variants).
    const existingDupes: string[] = [];
    const batchDupes: string[] = [];
    const seenKeys = new Set<string>();
    for (const c of colorOpts) {
      for (const s of sizeOpts) {
        for (const d of dimOpts) {
          const key = variantDupeKey({
            color: c,
            designVariant,
            dimension: d,
            size: s,
          });
          const label =
            [c, s, d, designVariant].filter(Boolean).join(" / ") ||
            "base variant";
          if (existingKeys.has(key)) {
            existingDupes.push(label);
          } else if (seenKeys.has(key)) {
            batchDupes.push(label);
          }
          seenKeys.add(key);
        }
      }
    }
    if (existingDupes.length || batchDupes.length) {
      const parts: string[] = [];
      if (existingDupes.length) {
        parts.push(
          `${existingDupes.length === 1 ? "Variant" : "Variants"} already exist${existingDupes.length === 1 ? "s" : ""}: ${existingDupes.join(", ")}.`,
        );
      }
      if (batchDupes.length) {
        parts.push(
          `These selections resolve to the same SKU as another combination you picked, since dimensions take priority over size — remove the duplicate size or dimension: ${batchDupes.join(", ")}.`,
        );
      }
      setSubmitError(parts.join(" "));
      return null;
    }

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
      if (data.dupeSkus?.length) {
        setPendingDupes(data.dupeSkus as DupeSkuConflict[]);
        return null;
      }
      if (!data.ok) throw new Error(data.error || "Failed to create variants");
      return data.skus as string[];
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    const skus = await createVariants();
    setSubmitting(false);
    if (skus) onCreated(skus);
  };

  const handleAddAndSync = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const skus = await createVariants();
    setSubmitting(false);
    if (!skus) return;

    setSyncing(true);
    try {
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
      setSyncing(false);
      onCreated(skus);
    } catch (err) {
      // Variants were already created successfully — leave the dialog open
      // showing the sync error rather than closing it (which would hide the
      // message immediately), same as DialogEditProduct's Save & Sync. The
      // sheet write already succeeded; sync can be retried from the
      // Products page like any other unsynced product.
      setSyncing(false);
      setSubmitError(
        `Variants created, but sync failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  };

  const resolveDupe = async (
    dupe: DupeSkuConflict,
    keep: "existing" | "new",
  ) => {
    const deleteDataIndex =
      keep === "existing" ? dupe.new.dataIndex : dupe.existing.dataIndex;
    setResolvingDupeSku(dupe.sku);
    setDupeResolveError(null);
    try {
      const res = await fetch(
        `/api/catalog/variant/${encodeURIComponent(dupe.sku)}?dataIndex=${deleteDataIndex}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = await res.json();
      if (!data.ok)
        throw new Error(data.error || "Failed to resolve duplicate");

      const remaining = (pendingDupes ?? []).filter((d) => d.sku !== dupe.sku);
      const nowResolved = [...resolvedSkus, dupe.sku];
      setPendingDupes(remaining);
      setResolvedSkus(nowResolved);
      if (remaining.length === 0) {
        onCreated(nowResolved);
      }
    } catch (err) {
      setDupeResolveError(
        err instanceof Error ? err.message : "Failed to resolve duplicate",
      );
    } finally {
      setResolvingDupeSku(null);
    }
  };

  return (
    <dialog ref={ref} className="dialog-variant card" onCancel={onClose}>
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
                          type="radio"
                          name="variant-dimension"
                          checked={selectedDimensions.has(d.value)}
                          onClick={() => selectDimension(d.value)}
                          onChange={() => {}}
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
              <label className="bold">
                Bulk Variant Description{" "}
                <span className="clr-muted xsmall">(optional)</span>
              </label>
              <RichTextEditor
                value={descriptionVariant}
                onChange={setDescriptionVariant}
                onOverLimit={setDescOverLimit}
                disabled={submitting}
                placeholder="Describe what's unique about this variant…"
                variant="simple"
                maxChars={150}
              />
            </div>
            {variantCount > 0 && !hasManualSelection && (
              <p className="small clr-warning">
                Pick at least one color, size, or design — a dimension alone
                (inherited from the product) isn't enough to create a
                variant.
              </p>
            )}
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
            {pendingDupes && pendingDupes.length > 0 && (
              <div className="grid gap-half">
                <p role="alert" className="status-line" data-tone="warning">
                  <AlertTriangle size={14} aria-hidden="true" /> SKU collision —
                  the sheet formula produced a SKU that already exists. Choose
                  which variant to keep for each conflict:
                </p>
                {pendingDupes.map((dupe) => (
                  <div
                    key={dupe.sku}
                    className="grid gap-quarter padding-half default-border"
                  >
                    <p className="small bold">{dupe.sku}</p>
                    <div className="row gap-half fw-wrap">
                      <button
                        type="button"
                        className="btn-secondary small"
                        onClick={() => void resolveDupe(dupe, "existing")}
                        disabled={resolvingDupeSku !== null}
                      >
                        {resolvingDupeSku === dupe.sku ? (
                          <span className="render-loader">Resolving…</span>
                        ) : (
                          <>
                            Keep existing:{" "}
                            <span className="clr-muted">
                              {dupe.existing.label}
                            </span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary small"
                        onClick={() => void resolveDupe(dupe, "new")}
                        disabled={resolvingDupeSku !== null}
                      >
                        {resolvingDupeSku === dupe.sku ? (
                          <span className="render-loader">Resolving…</span>
                        ) : (
                          <>
                            Keep new:{" "}
                            <span className="clr-muted">{dupe.new.label}</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
                {dupeResolveError && (
                  <p role="alert" className="status-line" data-tone="error">
                    {dupeResolveError}
                  </p>
                )}
              </div>
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
                disabled={
                  !canSubmit || submitting || syncing || pendingDupes !== null
                }
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
              {group.wooId && (
                <button
                  type="button"
                  className="btn-secondary row gap-half ai-cen"
                  onClick={() => void handleAddAndSync()}
                  disabled={
                    !canSubmit ||
                    submitting ||
                    syncing ||
                    pendingDupes !== null
                  }
                >
                  {syncing ? (
                    <span className="render-loader">Syncing…</span>
                  ) : (
                    <>
                      <Globe aria-hidden="true" />
                      <span>Add &amp; Sync</span>
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={submitting || syncing || resolvingDupeSku !== null}
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

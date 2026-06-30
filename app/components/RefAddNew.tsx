import { Pencil, Plus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { sizeRank } from "~/utils/sizeUtils";
import { suggestCode } from "~/utils/suggestCode";

export type RefAddType =
  | "color"
  | "size"
  | "dimension"
  | "graphicsVariant"
  | "graphic"
  | "style"
  | "category"
  | "subcategory";

export interface RefAddedEntry {
  value: string;
  code: string;
  wooId?: number;
  label?: string;
  parentCode?: string;
}

const CODED_TYPES = new Set<RefAddType>([
  "color",
  "size",
  "dimension",
  "graphicsVariant",
  "category",
  "subcategory",
]);
const CATEGORY_TYPES = new Set<RefAddType>(["category", "subcategory"]);

const TYPE_LABELS: Record<RefAddType, string> = {
  color: "color",
  size: "size",
  dimension: "dimension",
  graphicsVariant: "graphics variant",
  graphic: "graphic",
  style: "style",
  category: "category",
  subcategory: "subcategory",
};

const PLACEHOLDERS: Partial<Record<RefAddType, string>> = {
  graphic: "e.g. desert angels",
  style: "e.g. vintage",
  color: "e.g. forest green",
  size: "e.g. x-large",
  dimension: "e.g. 6x2",
  category: "e.g. accessories",
  subcategory: "e.g. sneakers",
};

function toTitleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface RefAddNewProps {
  refType: RefAddType;
  existingValues: string[];
  existingCodes: string[];
  onAdded: (entry: RefAddedEntry) => void;
  parentWooId?: number | null;
  parentCode?: string | null;
  parentDisplayName?: string;
  onExpandedChange?: (expanded: boolean) => void;
  disabled?: boolean;
  startExpanded?: boolean;
}

export default function RefAddNew({
  refType,
  existingValues,
  existingCodes,
  onAdded,
  parentWooId,
  parentCode,
  parentDisplayName,
  onExpandedChange,
  disabled,
  startExpanded,
}: RefAddNewProps) {
  const rawId = useId();
  const uid = `raf-${refType}-${rawId.replace(/\W/g, "")}`;
  const isCoded = CODED_TYPES.has(refType);
  const isCategoryType = CATEGORY_TYPES.has(refType);
  const isSubcategory = refType === "subcategory";

  const [expanded, setExpanded] = useState(startExpanded ?? false);
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [codeConflict, setCodeConflict] = useState(false);
  const [codeEditable, setCodeEditable] = useState(false);
  // label: display name — always shown for subcategory, auto-populated, user can override
  const [label, setLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setExpandedWithCallback = (next: boolean) => {
    setExpanded(next);
    onExpandedChange?.(next);
  };

  const collapse = () => {
    setExpandedWithCallback(false);
    setValue("");
    setCode("");
    setCodeConflict(false);
    setCodeEditable(false);
    setLabel("");
    setLabelTouched(false);
    setError(null);
  };

  // Auto-suggest code from value
  useEffect(() => {
    if (!isCoded || !value.trim()) {
      setCode("");
      setCodeConflict(false);
      setCodeEditable(false);
      return;
    }

    let suggestedCode: string;
    let hasConflict: boolean;

    if (refType === "dimension") {
      // Derive code from digits and X-separator only (e.g. 6"x2" → 6X2, 12x2 → 12X2)
      const upper = existingCodes.map((c) => c.toUpperCase());
      suggestedCode = value
        .trim()
        .toUpperCase()
        .replace(/[^0-9X]/g, "")
        .slice(0, 4);
      hasConflict = suggestedCode.length < 2 || upper.includes(suggestedCode);
    } else {
      const suggestion = suggestCode(value.trim(), existingCodes);
      suggestedCode = suggestion.code;
      hasConflict = suggestion.conflict;
    }

    setCode(suggestedCode);
    setCodeConflict(hasConflict);
    if (hasConflict) setCodeEditable(true);
  }, [value, existingCodes, isCoded, refType]);

  // Auto-populate subcategory label from value (title-cased), unless user has touched it
  useEffect(() => {
    if (!isSubcategory) return;
    if (!labelTouched) {
      setLabel(value.trim() ? toTitleCase(value.trim()) : "");
    }
  }, [value, isSubcategory, labelTouched]);

  const minCodeLen = refType === "size" ? 2 : 3;

  const newSizeRank = refType === "size" ? sizeRank(value.trim()) : 999;
  const aliasConflict =
    newSizeRank !== 999
      ? (existingValues.find((v) => sizeRank(v) === newSizeRank) ?? null)
      : null;
  const isDuplicate =
    existingValues.some(
      (v) => v.toLowerCase() === value.trim().toLowerCase(),
    ) || aliasConflict !== null;

  const codeInUse =
    isCoded &&
    code.length >= minCodeLen &&
    existingCodes.map((c) => c.toUpperCase()).includes(code.toUpperCase());

  const subcatMissingParent = isSubcategory && !parentCode?.trim();

  const canSubmit =
    value.trim().length > 0 &&
    !isDuplicate &&
    !subcatMissingParent &&
    (!isCoded || (code.length >= minCodeLen && !codeInUse));

  const handleAdd = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const normalizedValue = value.trim().toLowerCase();
      const body: Record<string, unknown> = {
        type: refType,
        value: normalizedValue,
        code: code || undefined,
      };
      if (isSubcategory) {
        body.parentWooId = parentWooId;
        body.parentCode = parentCode;
        // Always send label for subcategory; fallback to title-cased value
        body.label = label.trim() || toTitleCase(normalizedValue);
      }

      const res = await fetch("/api/catalog/ref/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to add entry");

      onAdded({
        value: data.value as string,
        code: (data.code as string) ?? "",
        wooId: isCategoryType ? (data.wooId as number) : undefined,
        label: isCategoryType ? (data.label as string) : undefined,
        parentCode: isSubcategory ? (data.parentCode as string) : undefined,
      });
      collapse();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  };

  const triggerDisabled = disabled || subcatMissingParent;
  const triggerTitle = subcatMissingParent
    ? "Select a category before adding a subcategory"
    : undefined;

  if (!expanded) {
    return (
      <button
        type="button"
        className="ref-add__trigger btn-ghost margin-is-auto row gap-quarter ai-cen"
        onClick={() => setExpandedWithCallback(true)}
        disabled={triggerDisabled}
        title={triggerTitle}
        aria-expanded={false}
        aria-controls={`${uid}-body`}
      >
        <Plus aria-hidden="true" />
        <span>Add new</span>
      </button>
    );
  }

  return (
    <div className="ref-add" id={`${uid}-body`} data-reftype={refType}>
      <div className="form-group" data-value={refType}>
        <label htmlFor={`${uid}-val`}>New {TYPE_LABELS[refType]}</label>
        <input
          id={`${uid}-val`}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          minLength={2}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={PLACEHOLDERS[refType] ?? ""}
          disabled={submitting}
          autoFocus
        />
        {isSubcategory && parentDisplayName && (
          <p className="ref-add__hint clr-muted">
            Parent Category: <strong>{parentDisplayName}</strong>
          </p>
        )}
        {isDuplicate && (
          <p role="alert" className="ref-add__hint ref-add__hint--warn">
            {aliasConflict &&
            aliasConflict.toLowerCase() !== value.trim().toLowerCase()
              ? `"${value.trim()}" already exists as "${aliasConflict}"`
              : `"${value.trim()}" already exists`}
          </p>
        )}
      </div>

      {isCoded && value.trim().length >= 2 && (
        <div className="form-group" data-code={refType}>
          <label htmlFor={`${uid}-code`}>
            Code{" "}
            {codeConflict ? (
              <span className="clr-danger">— conflict</span>
            ) : null}
          </label>
          {codeConflict || codeEditable ? (
            <>
              <input
                id={`${uid}-code`}
                type="text"
                value={code}
                onChange={(e) =>
                  setCode(
                    e.target.value
                      .toUpperCase()
                      .replace(
                        refType === "dimension" ? /[^A-Z0-9]/g : /[^A-Z]/g,
                        "",
                      )
                      .slice(0, 4),
                  )
                }
                minLength={minCodeLen}
                maxLength={4}
                placeholder={refType === "size" ? "AB" : "ABC"}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                disabled={submitting}
                className="ref-add__code-input"
              />
              {code.length >= minCodeLen && codeInUse && (
                <p role="alert" className="ref-add__hint ref-add__hint--warn">
                  "{code}" is already in use
                </p>
              )}
            </>
          ) : (
            <div className="row gap-quarter ai-cen">
              <p role="status" className="ref-add__code-chip">
                {code}
              </p>
              <button
                type="button"
                onClick={() => setCodeEditable(true)}
                title="Edit code"
                disabled={submitting}
              >
                <Pencil size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}

      {isSubcategory && value.trim().length >= 2 && (
        <div className="form-group" data-display-label={refType}>
          <label htmlFor={`${uid}-label`}>Display label</label>
          <input
            id={`${uid}-label`}
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setLabelTouched(true);
            }}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            minLength={2}
            placeholder={toTitleCase(value.trim())}
            disabled={submitting}
          />
          <p className="ref-add__hint clr-muted">
            Format for default Product Name
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="ref-add__hint ref-add__hint--warn">
          {error}
        </p>
      )}

      <div className="row gap-half ai-cen fw-wrap margin-bs-half">
        <button
          type="button"
          className="btn-primary row gap-quarter jc-cen ai-cen"
          onClick={handleAdd}
          disabled={!canSubmit || submitting}
        >
          <Plus aria-hidden="true" />
          <span>
            {submitting
              ? isCategoryType
                ? "Creating in Woo…"
                : "Adding…"
              : "Add"}
          </span>
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={collapse}
          disabled={submitting}
        >
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );
}

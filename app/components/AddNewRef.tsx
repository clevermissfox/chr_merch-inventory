import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

export type RefAddType =
  | "color"
  | "size"
  | "dimension"
  | "graphicsVariant"
  | "graphic"
  | "style";

const CODED_TYPES = new Set<RefAddType>(["color", "size", "dimension", "graphicsVariant"]);

interface AddNewRefProps {
  refType: RefAddType;
  existingValues: string[];
  existingCodes: string[];
  onAdded: (entry: { value: string; code: string }) => void;
  disabled?: boolean;
}

function suggestCode(value: string, existingCodes: string[]): { code: string; conflict: boolean } {
  const upper = existingCodes.map((c) => c.toUpperCase());
  const words = value
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Z]/g, ""))
    .filter(Boolean);
  const alpha = words.join("");

  const ok = (candidate: string) =>
    candidate.length >= 2 && !upper.includes(candidate) ? candidate : null;

  if (words.length === 1) {
    // single word: prefer shorter codes (SM, GRE, FORE) — try 2, 3, 4 chars
    const found = [ok(alpha.slice(0, 2)), ok(alpha.slice(0, 3)), ok(alpha.slice(0, 4))].find(Boolean);
    return found ? { code: found, conflict: false } : { code: alpha.slice(0, 4), conflict: true };
  }

  const w0 = words[0];
  const w1 = words[1];

  // multi-word: 4 chars total, progressively more distinctive
  const candidates = [
    ok(alpha.slice(0, 4)),                            // FORE (first 4 of joined)
    ok((w0.slice(0, 3) + w1[0]).slice(0, 4)),        // FORG (3+1)
    ok((w0.slice(0, 2) + w1.slice(0, 2)).slice(0, 4)), // FOGR (2+2)
    ok(words.map((w) => w[0]).join("").slice(0, 4)), // FG.. (initials)
  ];

  const found = candidates.find(Boolean);
  return found ? { code: found, conflict: false } : { code: alpha.slice(0, 4), conflict: true };
}

export default function AddNewRef({
  refType,
  existingValues,
  existingCodes,
  onAdded,
  disabled,
}: AddNewRefProps) {
  const isCoded = CODED_TYPES.has(refType);
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [codeConflict, setCodeConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCoded || !value.trim()) {
      setCode("");
      setCodeConflict(false);
      return;
    }
    const suggestion = suggestCode(value.trim(), existingCodes);
    setCode(suggestion.code);
    setCodeConflict(suggestion.conflict);
  }, [value, existingCodes, isCoded]);

  const isDuplicate = existingValues.some(
    (v) => v.toLowerCase() === value.trim().toLowerCase(),
  );
  const codeInUse =
    isCoded && code && existingCodes.map((c) => c.toUpperCase()).includes(code.toUpperCase());

  const canSubmit =
    value.trim().length > 0 &&
    !isDuplicate &&
    (!isCoded || (code.length >= 2 && !codeInUse));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/catalog/ref/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ type: refType, value: value.trim(), code: code || undefined }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to add entry");
      onAdded({ value: data.value as string, code: (data.code as string) ?? "" });
      setValue("");
      setCode("");
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setSubmitting(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="form-add-ref__trigger btn-ghost row gap-quarter ai-cen"
        onClick={() => setExpanded(true)}
        disabled={disabled}
      >
        <Plus aria-hidden="true" />
        <span>Add new</span>
      </button>
    );
  }

  return (
    <form className="form-add-ref" onSubmit={handleSubmit}>
      <div className="row gap-half fw-wrap ai-end">
        <div className="form-group flex-1">
          <label className="xsmall ls-1">New value</label>
          <input
            type="text"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder={refType === "graphic" ? "e.g. Desert Angels" : `e.g. Forest Green`}
            disabled={submitting}
            autoFocus
          />
          {isDuplicate && (
            <p role="alert" className="form-add-ref__hint form-add-ref__hint--warn">
              "{value.trim()}" already exists
            </p>
          )}
        </div>

        {isCoded && value.trim() && (
          <div className="form-group">
            <label className="xsmall ls-1">
              Code {codeConflict ? <span className="clr-danger">— conflict</span> : null}
            </label>
            {codeConflict ? (
              <>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
                  maxLength={4}
                  placeholder="ABC"
                  disabled={submitting}
                  className="form-add-ref__code-input"
                  aria-describedby="code-conflict-hint"
                />
                <p id="code-conflict-hint" role="alert" className="form-add-ref__hint form-add-ref__hint--warn">
                  "{code}" is taken — enter a unique code
                </p>
              </>
            ) : (
              <p role="status" className="form-add-ref__code-chip">{code}</p>
            )}
            {codeInUse && (
              <p role="alert" className="form-add-ref__hint form-add-ref__hint--warn">"{code}" is already in use</p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="form-add-ref__hint form-add-ref__hint--warn">{error}</p>
      )}

      <div className="row gap-half ai-cen">
        <button
          type="submit"
          className="btn-primary"
          disabled={!canSubmit || submitting}
        >
          {submitting ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            setExpanded(false);
            setValue("");
            setCode("");
            setError(null);
          }}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState, useTransition } from "react";
import type { CatalogGroup, CatalogRow } from "~/types/catalog";

export type SearchResult =
  | { kind: "group"; group: CatalogGroup }
  | { kind: "row"; row: CatalogRow; group: CatalogGroup };

export function searchCatalog(
  groups: CatalogGroup[],
  query: string,
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const words = q.split(/\s+/).filter(Boolean);

  const hits = (str: string) => words.every((w) => str.includes(w));

  const str = (...parts: (string | null | undefined)[]) =>
    parts.filter(Boolean).join(" ").toLowerCase();

  const results: SearchResult[] = [];

  for (const group of groups) {
    const groupStr = str(
      group.sku,
      group.productName,
      group.displayName,
      group.readableName,
      group.category,
      group.subcategory,
      group.design,
      group.styleModifier,
    );

    if (group.rows.length === 0) {
      if (hits(groupStr)) results.push({ kind: "group", group });
      continue;
    }

    const matchedRows = group.rows.filter((row) => {
      const rowStr = str(row.sku, row.variantDetails, row.readableName);
      // combine group context so "accessories small" matches a small variant in accessories
      return hits(groupStr + " " + rowStr);
    });

    if (matchedRows.length > 0) {
      for (const row of matchedRows) results.push({ kind: "row", row, group });
    } else if (hits(groupStr)) {
      results.push({ kind: "group", group });
    }
  }

  return results;
}

interface SearchComponentProps {
  groups: CatalogGroup[];
  label?: string;
  placeholder?: string;
  resultKind?: "all" | "rows" | "groups";
  maxResults?: number;
  onSelect: (result: SearchResult) => void;
  renderResult: (result: SearchResult) => React.ReactNode;
}

export default function SearchComponent({
  groups,
  label = "Search",
  placeholder = "SKU, name, color, size…",
  resultKind = "all",
  maxResults = 20,
  onSelect,
  renderResult,
}: SearchComponentProps) {
  const uid = useId();
  const inputId = `${uid}-search`;
  const listId = `${uid}-results`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [deferredQuery, setDeferredQuery] = useState("");
  const [, startTransition] = useTransition();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    startTransition(() => setDeferredQuery(v));
  };

  const clear = () => {
    setQuery("");
    setDeferredQuery("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      onSelect(results[0]);
      clear();
    }
  };

  const results = useMemo(() => {
    const all = searchCatalog(groups, deferredQuery);
    const filtered =
      resultKind === "all"
        ? all
        : all.filter(
            (r) => r.kind === (resultKind === "rows" ? "row" : "group"),
          );
    return filtered.slice(0, maxResults);
  }, [groups, deferredQuery, resultKind, maxResults]);

  const showResults = deferredQuery.trim().length >= 2;

  return (
    <form className="search-catalog" onSubmit={(e) => e.preventDefault()}>
      <div className="form-group">
        <label htmlFor={inputId}>{label}</label>
        <div className="search-input-wrapper">
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={showResults && results.length > 0}
          />
          {query ? (
            <button
              type="button"
              className=" search-clear"
              onClick={clear}
              aria-label="Clear search"
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : (
            <div className="icon-wrapper">
              <Search className="search-icon" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>

      {showResults && (
        <ul
          id={listId}
          className="search-results"
          role="list"
          aria-label="Search results"
        >
          {results.length === 0 ? (
            <li className="search-results__empty clr-muted small">
              No results for "{deferredQuery.trim()}"
            </li>
          ) : (
            results.map((result, i) => (
              <li
                key={
                  result.kind === "row"
                    ? result.row.sku
                    : result.group.sku + "-g"
                }
              >
                <button
                  type="button"
                  className="search-results__item"
                  onClick={() => {
                    onSelect(result);
                    clear();
                  }}
                >
                  {renderResult(result)}
                </button>
              </li>
            ))
          )}
          {results.length === maxResults && (
            <li className="search-results__overflow clr-muted xsmall">
              Showing first {maxResults} — refine your search
            </li>
          )}
        </ul>
      )}
    </form>
  );
}

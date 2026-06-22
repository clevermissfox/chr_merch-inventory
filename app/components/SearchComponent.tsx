import { Search } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import type { CatalogGroup } from "~/types/catalog";

interface SearchComponentProps<T> {
  idSuffix: string;
  data: CatalogGroup;
  searchKeys: (keyof T)[];
  placeholder?: string;
  label?: string;
  onSelectResult: (item: T) => void;
  renderResultItem: (item: T) => React.ReactNode;
}

export function SearchComponent<T extends Record<string, any>>({
  idSuffix,
  data,
  searchKeys,
  placeholder,
  label,
  onSelectResult,
  renderResultItem,
}: SearchComponentProps<T>) {
  const [query, setQuery] = useState("");
  const [deferredQuery, setDeferredQuery] = useState("");
  const [, startTransition] = useTransition();
  const inputId = `field-search-${idSuffix}`;

  // Handle typing smoothly
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    startTransition(() => {
      setDeferredQuery(e.target.value);
    });
  };

  // Filter data based on multiple query words
  const filteredResults = useMemo(() => {
    const cleanQuery = deferredQuery.trim().toLowerCase();
    if (!cleanQuery) return [];

    const searchWords = cleanQuery.split(/\s+/); // Split by spaces

    return data.filter((item) => {
      return searchWords.every((word) =>
        searchKeys.some((key) => {
          const value = item[key];
          if (value === undefined || value === null) return false;
          return String(value).toLowerCase().includes(word);
        }),
      );
    });
  }, [deferredQuery, data, searchKeys]);
  return (
    <>
      <form
        className={`form-search form-search-${idSuffix}`}
        id={`form-search-${idSuffix}`}
      >
        <div className="form-group">
          <label htmlFor={inputId}>{label ? label : "Search"}</label>
          <div className="input-wrapper">
            <input
              type="search"
              id={inputId}
              minLength={3}
              name={`${idSuffix}`}
              placeholder={placeholder}
              enterKeyHint="search"
            />
            <button type="submit" aria-label="Search">
              <Search aria-hidden="true" />
            </button>
          </div>
        </div>
      </form>

      {filteredResults.length > 0 && (
        <ul className="list-search-results" role="list">
          {filteredResults.map((item, index) => (
            <li
              key={item.id || index}
              onClick={() => {
                onSelectResult(item);
                setQuery("");
                setDeferredQuery("");
              }}
            >
              {renderResultItem(item)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useEffect,
  type ReactNode,
} from "react";

import type {
  CatalogPayload,
  CatalogState,
  DirtyStockChange,
} from "../types/catalog";

const CATALOG_SESSION_STORAGE_KEY =
  import.meta.env.VITE_CATALOG_SESSION_STORAGE_KEY || "chr-merch-catalog";
const CATALOG_CACHE_TTL_MS = 15 * 60 * 1000;

const initialState: CatalogState = {
  catalog: null,
  dirtyBySku: {},
  loading: false,
  saving: false,
  error: null,
};

function initializeCatalogState(): CatalogState {
  if (typeof window === "undefined") {
    return initialState;
  }

  try {
    const stored = window.sessionStorage.getItem(CATALOG_SESSION_STORAGE_KEY);

    if (!stored) {
      return initialState;
    }

    const parsed = JSON.parse(stored) as {
      catalog?: CatalogPayload | null;
      cachedAt?: number;
    };

    const cachedAt = typeof parsed.cachedAt === "number" ? parsed.cachedAt : 0;

    if (!parsed.catalog || !cachedAt) {
      window.sessionStorage.removeItem(CATALOG_SESSION_STORAGE_KEY);
      return initialState;
    }

    if (Date.now() - cachedAt > CATALOG_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(CATALOG_SESSION_STORAGE_KEY);
      return initialState;
    }

    return {
      ...initialState,
      catalog: parsed.catalog,
    };
  } catch {
    return initialState;
  }
}
type CatalogAction =
  | { type: "LOAD_START" }
  | { type: "LOAD_SUCCESS"; payload: CatalogPayload }
  | { type: "LOAD_ERROR"; payload: string }
  | { type: "SET_STOCK_QTY"; payload: DirtyStockChange }
  | { type: "CLEAR_DIRTY" }
  | { type: "SAVE_START" }
  | { type: "SAVE_END" }
  | { type: "RESET_ERROR" };

interface CatalogContextValue {
  state: CatalogState;
  loadCatalog: (force?: boolean) => Promise<void>;
  setStockQty: (
    sku: string,
    stockQty: number | "",
    originalStockQty?: number | null,
  ) => void;
  clearDirty: () => void;
  saveCatalogChanges: () => Promise<void>;
  resolveCatalogConflicts: () => Promise<void>;
  resetError: () => void;
}

function catalogReducer(
  state: CatalogState,
  action: CatalogAction,
): CatalogState {
  switch (action.type) {
    case "LOAD_START":
      return {
        ...state,
        loading: true,
        error: null,
      };

    case "LOAD_SUCCESS":
      return {
        ...state,
        loading: false,
        error: null,
        catalog: action.payload,
        dirtyBySku: {},
      };

    case "LOAD_ERROR":
      return {
        ...state,
        loading: false,
        error: action.payload,
      };

    case "SET_STOCK_QTY": {
      const { sku, stockQty, originalStockQty } = action.payload;

      const normalizedOriginal = originalStockQty ?? null;
      const normalizedNext = stockQty === "" ? null : stockQty;

      if (normalizedNext === normalizedOriginal) {
        const { [sku]: _removed, ...remainingDirtyBySku } = state.dirtyBySku;

        return {
          ...state,
          dirtyBySku: remainingDirtyBySku,
        };
      }

      return {
        ...state,
        dirtyBySku: {
          ...state.dirtyBySku,
          [sku]: {
            sku,
            stockQty,
            originalStockQty: normalizedOriginal,
          },
        },
      };
    }

    case "CLEAR_DIRTY":
      return {
        ...state,
        dirtyBySku: {},
      };

    case "SAVE_START":
      return {
        ...state,
        saving: true,
        error: null,
      };

    case "SAVE_END":
      return {
        ...state,
        saving: false,
      };

    case "RESET_ERROR":
      return {
        ...state,
        error: null,
      };

    default:
      return state;
  }
}

const CatalogContext = createContext<CatalogContextValue | undefined>(
  undefined,
);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(
    catalogReducer,
    initialState,
    initializeCatalogState,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (state.catalog) {
        window.sessionStorage.setItem(
          CATALOG_SESSION_STORAGE_KEY,
          JSON.stringify({
            catalog: state.catalog,
            cachedAt: Date.now(),
          }),
        );
      } else {
        window.sessionStorage.removeItem(CATALOG_SESSION_STORAGE_KEY);
      }
    } catch {
      // ignore storage write errors
    }
  }, [state.catalog]);

  const loadCatalog = useCallback(
    async (force = false) => {
      if (!force && state.catalog) {
        return;
      }

      dispatch({ type: "LOAD_START" });

      try {
        const response = await fetch("/api/catalog/inventory/get_stock", {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || "Failed to load catalog");
        }

        dispatch({ type: "LOAD_SUCCESS", payload: data as CatalogPayload });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load catalog";
        dispatch({ type: "LOAD_ERROR", payload: message });
      }
    },
    [state.catalog],
  );

  const setStockQty = useCallback(
    (
      sku: string,
      stockQty: number | "",
      originalStockQty: number | null = null,
    ) => {
      dispatch({
        type: "SET_STOCK_QTY",
        payload: { sku, stockQty, originalStockQty },
      });
    },
    [],
  );

  const clearDirty = useCallback(() => {
    dispatch({ type: "CLEAR_DIRTY" });
  }, []);

  const saveCatalogChanges = useCallback(async () => {
    const changes = Object.values(state.dirtyBySku);

    if (!changes.length) {
      return;
    }

    dispatch({ type: "SAVE_START" });

    try {
      await postStockSync({
        changes,
        mode: "standard_sync",
      });

      clearDirty();
      await loadCatalog(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync stock";
      dispatch({ type: "LOAD_ERROR", payload: message });
    } finally {
      dispatch({ type: "SAVE_END" });
    }
  }, [state.dirtyBySku, clearDirty, loadCatalog]);

  const resolveCatalogConflicts = useCallback(async () => {
    if (!state.catalog) {
      return;
    }

    const changes: Array<{ sku: string; stockQty: number | "" }> =
      state.catalog.groups.flatMap((group) =>
        group.rows
          .filter((row) => row.stockQty !== row.wooStock)
          .map((row) => ({
            sku: row.sku,
            stockQty: typeof row.stockQty === "number" ? row.stockQty : "",
          })),
      );

    if (!changes.length) {
      return;
    }

    dispatch({ type: "SAVE_START" });

    try {
      await postStockSync({
        changes,
        mode: "resolve_conflicts",
      });

      await loadCatalog(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve conflicts";
      dispatch({ type: "LOAD_ERROR", payload: message });
    } finally {
      dispatch({ type: "SAVE_END" });
    }
  }, [state.catalog, loadCatalog]);

  const resetError = useCallback(() => {
    dispatch({ type: "RESET_ERROR" });
  }, []);

  async function postStockSync({
    changes,
    mode,
  }: {
    changes: Array<{ sku: string; stockQty: number | "" }>;
    mode?: "standard_sync" | "resolve_conflicts";
  }) {
    const response = await fetch("/api/catalog/inventory/sync_stock", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(mode ? { mode } : {}),
        changes,
      }),
    });

    const data = await response.json();

    const topLevelOk =
      typeof data === "object" && data !== null && "ok" in data
        ? data.ok !== false
        : true;

    if (!response.ok || !topLevelOk) {
      const errorMessage =
        (typeof data === "object" && data !== null && "error" in data
          ? String(data.error)
          : null) || "Failed to sync stock";

      throw new Error(errorMessage);
    }

    return data;
  }

  return (
    <CatalogContext.Provider
      value={{
        state,
        loadCatalog,
        setStockQty,
        clearDirty,
        saveCatalogChanges,
        resolveCatalogConflicts,
        resetError,
      }}
    >
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog() {
  const context = useContext(CatalogContext);

  if (!context) {
    throw new Error("useCatalog must be used within a CatalogProvider");
  }

  return context;
}

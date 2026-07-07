import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  type ReactNode,
} from "react";

import type {
  CatalogPayload,
  CatalogState,
  DirtyStockChange,
  StockSyncMode,
  SyncResult,
} from "../types/catalog";

const initialState: CatalogState = {
  catalog: null,
  dirtyBySku: {},
  loading: false,
  saving: false,
  error: null,
};

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
  loadCatalog: (options?: { withStock?: boolean }) => Promise<void>;
  setStockQty: (
    sku: string,
    stockQty: number | "",
    originalStockQty?: number | null,
  ) => void;
  clearDirty: () => void;
  syncSelectedSkus: (
    skus: string[],
    overrideDirty?: Record<string, DirtyStockChange>,
    mode?: StockSyncMode,
  ) => Promise<SyncResult>;
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
  const [state, dispatch] = useReducer(catalogReducer, initialState);

  const loadCatalog = useCallback(async (options?: { withStock?: boolean }) => {
    dispatch({ type: "LOAD_START" });

    const url = options?.withStock
      ? "/api/catalog/inventory/get_stock"
      : "/api/catalog";

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
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
  }, []);

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

  const syncSelectedSkus = useCallback(
    async (
      skus: string[],
      overrideDirty?: Record<string, DirtyStockChange>,
      mode: StockSyncMode = "standard_sync",
    ): Promise<SyncResult> => {
      if (!state.catalog || skus.length === 0) {
        return { updatedCount: 0, skippedCount: 0, skipped: [] };
      }

      const rowBySku = new Map(
        state.catalog.groups.flatMap((g) => g.rows.map((r) => [r.sku, r])),
      );
      const groupBySku = new Map(
        state.catalog.groups.map((g) => [g.sku, g]),
      );

      const syntheticDirty: CatalogState["dirtyBySku"] = {};
      for (const sku of skus) {
        const dirtyEntry = overrideDirty?.[sku] ?? state.dirtyBySku[sku];
        if (dirtyEntry) {
          syntheticDirty[sku] = dirtyEntry;
        } else {
          const row = rowBySku.get(sku);
          if (row) {
            syntheticDirty[sku] = {
              sku,
              stockQty: row.stockQty ?? 0,
              originalStockQty: row.wooStock,
            };
          } else {
            // simple product — no variant rows, use group-level stock
            const group = groupBySku.get(sku);
            if (!group) continue;
            syntheticDirty[sku] = {
              sku,
              stockQty: group.stockQty ?? 0,
              originalStockQty: group.wooStock,
            };
          }
        }
      }

      dispatch({ type: "SAVE_START" });

      try {
        const data = await postCatalogStockSync({
          catalog: state.catalog,
          dirtyBySku: syntheticDirty,
          mode,
        });

        if (data?.catalog) {
          dispatch({ type: "LOAD_SUCCESS", payload: data.catalog });
        } else {
          await loadCatalog({ withStock: true });
        }

        const updatedSkus: unknown[] = Array.isArray(data?.updatedSkus)
          ? data.updatedSkus
          : [];
        const skipped: Array<{ sku: string; reason: string }> = Array.isArray(
          data?.skipped,
        )
          ? data.skipped
          : [];

        return {
          updatedCount: updatedSkus.length,
          skippedCount: skipped.length,
          skipped,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to sync stock";
        dispatch({ type: "LOAD_ERROR", payload: message });
        throw error;
      } finally {
        dispatch({ type: "SAVE_END" });
      }
    },
    [state.catalog, state.dirtyBySku, loadCatalog],
  );

  const resetError = useCallback(() => {
    dispatch({ type: "RESET_ERROR" });
  }, []);

  /**
   * Posts the current catalog snapshot and sync metadata to the backend stock sync route.
   * Throws when the route returns a non-OK HTTP status or an error payload.
   */
  async function postCatalogStockSync({
    catalog,
    dirtyBySku,
    mode,
  }: {
    catalog: CatalogPayload;
    dirtyBySku: CatalogState["dirtyBySku"];
    mode?: StockSyncMode;
  }) {
    const response = await fetch("/api/catalog/inventory/sync_stock", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        catalog,
        dirtyBySku,
        ...(mode ? { mode } : {}),
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
        syncSelectedSkus,
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

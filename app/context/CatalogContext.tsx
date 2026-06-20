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
  loadCatalog: () => Promise<void>;
  setStockQty: (
    sku: string,
    stockQty: number | "",
    originalStockQty?: number | null,
  ) => void;
  clearDirty: () => void;
  syncCatalogStock: (
    mode?: "standard_sync" | "resolve_conflicts" | "sync_all",
  ) => Promise<void>;
  syncSelectedSkus: (skus: string[]) => Promise<SyncResult>;
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
  const [state, dispatch] = useReducer(catalogReducer, initialState);

  const loadCatalog = useCallback(async () => {
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

  /*
    LEGACY: Used to sync via worker + GAS- removed from interface + values too
  */
  // const saveCatalogChanges = useCallback(async () => {
  //   const changes = Object.values(state.dirtyBySku);

  //   if (!changes.length) {
  //     return;
  //   }

  //   dispatch({ type: "SAVE_START" });

  //   try {
  //     await postCatalogChanges({
  //       changes,
  //       mode: "standard_sync",
  //     });

  //     clearDirty();
  //     await loadCatalog();
  //   } catch (error) {
  //     const message =
  //       error instanceof Error ? error.message : "Failed to sync stock";
  //     dispatch({ type: "LOAD_ERROR", payload: message });
  //   } finally {
  //     dispatch({ type: "SAVE_END" });
  //   }
  // }, [state.dirtyBySku, clearDirty, loadCatalog]);

  /**
   * Sends the current catalog snapshot to the backend stock sync route.
   * Includes current dirty rows so the backend can support delta-style syncs if needed.
   * Reloads the catalog after a successful sync so the UI reflects confirmed Woo values.
   */
  const syncCatalogStock = useCallback(
    async (
      mode:
        | "standard_sync"
        | "resolve_conflicts"
        | "sync_all" = "standard_sync",
    ) => {
      if (!state.catalog) {
        return;
      }

      dispatch({ type: "SAVE_START" });

      try {
        await postCatalogStockSync({
          catalog: state.catalog,
          dirtyBySku: state.dirtyBySku,
          mode,
        });
        await loadCatalog();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to sync stock";
        dispatch({ type: "LOAD_ERROR", payload: message });
      } finally {
        dispatch({ type: "SAVE_END" });
      }
    },
    [state.catalog, state.dirtyBySku, clearDirty, loadCatalog],
  );

  const syncSelectedSkus = useCallback(
    async (skus: string[]): Promise<SyncResult> => {
      if (!state.catalog || skus.length === 0) {
        return { updatedCount: 0, skippedCount: 0 };
      }

      const rowBySku = new Map(
        state.catalog.groups.flatMap((g) => g.rows.map((r) => [r.sku, r])),
      );

      const syntheticDirty: CatalogState["dirtyBySku"] = {};
      for (const sku of skus) {
        if (state.dirtyBySku[sku]) {
          syntheticDirty[sku] = state.dirtyBySku[sku];
        } else {
          const row = rowBySku.get(sku);
          if (!row) continue;
          syntheticDirty[sku] = {
            sku,
            stockQty: row.stockQty ?? 0,
            originalStockQty: row.wooStock,
          };
        }
      }

      dispatch({ type: "SAVE_START" });

      try {
        const data = await postCatalogStockSync({
          catalog: state.catalog,
          dirtyBySku: syntheticDirty,
          mode: "standard_sync",
        });

        await loadCatalog();

        const updatedSkus: unknown[] = Array.isArray(data?.updatedSkus)
          ? data.updatedSkus
          : [];
        const skipped: unknown[] = Array.isArray(data?.skipped)
          ? data.skipped
          : [];

        return { updatedCount: updatedSkus.length, skippedCount: skipped.length };
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
      await postCatalogChanges({
        changes,
        mode: "resolve_conflicts",
      });

      await loadCatalog();
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

  async function postCatalogChanges({
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
    mode?: "standard_sync" | "resolve_conflicts" | "sync_all";
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
        syncCatalogStock,
        syncSelectedSkus,
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

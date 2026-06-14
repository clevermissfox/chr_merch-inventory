import { createContext, useContext, useReducer, type ReactNode } from "react";
import type {
  CatalogPayload,
  CatalogState,
  DirtyStockChange,
} from "../types/catalog";

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
  resetError: () => void;
}

const initialState: CatalogState = {
  catalog: null,
  dirtyBySku: {},
  loading: false,
  saving: false,
  error: null,
};

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

  async function loadCatalog(force = false) {
    if (!force && state.catalog) {
      return;
    }

    dispatch({ type: "LOAD_START" });

    try {
      const response = await fetch("/api/catalog/inventory", {
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
  }

  function setStockQty(
    sku: string,
    stockQty: number | "",
    originalStockQty: number | null = null,
  ) {
    dispatch({
      type: "SET_STOCK_QTY",
      payload: { sku, stockQty, originalStockQty },
    });
  }

  function clearDirty() {
    dispatch({ type: "CLEAR_DIRTY" });
  }

  function resetError() {
    dispatch({ type: "RESET_ERROR" });
  }

  return (
    <CatalogContext.Provider
      value={{
        state,
        loadCatalog,
        setStockQty,
        clearDirty,
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

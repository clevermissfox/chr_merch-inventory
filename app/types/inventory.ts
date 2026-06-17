export interface TrackedStockRow {
  sku: string;
  rowType: "product" | "variant";
  productId: string;
  parentSku: string | null;
  wooId: string | null;
  variantId: string | null;
  wooVariantId: string | null;
}

export type SyncQty = number | null;

export interface StockSyncChange {
  sku: string;
  stockQty: number | "";
}

export interface StockSyncVariationTarget {
  rowType: "variant";
  sku: string;
  qty: SyncQty;
  productId: string;
  parentSku: string;
  wooId: string | null;
  variantId: string | null;
  wooVariantId: string | null;
  label: string;
}

export interface StockSyncSimpleTarget {
  rowType: "product";
  sku: string;
  qty: SyncQty;
  productId: string;
  parentSku: string;
  wooId: string | null;
  label: string;
}

export interface StockSyncProductPlan {
  productId: string;
  parentSku: string;
  wooId: string | null;
  productName: string;
  simpleTarget: StockSyncSimpleTarget | null;
  variationTargets: StockSyncVariationTarget[];
}

export interface StockSyncPlan {
  changeMap: Map<string, SyncQty>;
  products: StockSyncProductPlan[];
  skipped: Array<{
    sku: string;
    reason: "missing_sku" | "not_found" | "variable_parent_not_editable";
  }>;
  updatedSkus: string[];
}

export interface WooSyncResult {
  ok: true;
  updatedProducts: number;
  updatedSkus: string[];
  skipped: Array<{
    sku: string;
    reason: string;
  }>;
}

export interface InventoryIndexSheetRow {
  sku: string;
  stock_qty: string;
  woo_stock: string;
  last_sync_at: string;
}

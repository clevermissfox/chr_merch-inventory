export interface CatalogConflictGroup {
  productId: string;
  displayName: string;
  count: number;
}

export interface CatalogRow {
  sku: string;
  label: string;
  stockQty: number | null;
  wooStock: number | null;
  lastSyncAt: string | null;
  rowType: "product" | "variant";
}

export interface CatalogGroup {
  productId: string;
  productSku: string;
  displayName: string;
  rowCount: number;
  rows: CatalogRow[];
}

export interface CatalogSummary {
  productCount: number;
  groupCount: number;
  rowCount: number;
  unsyncedCount: number;
  conflictGroups: CatalogConflictGroup[];
}

export interface CatalogPayload {
  ok: true;
  generatedAt: string;
  summary: CatalogSummary;
  groups: CatalogGroup[];
  userEmail?: string;
  role?: string;
  canEdit?: boolean;
}

export interface CatalogState {
  catalog: CatalogPayload | null;
  dirtyBySku: Record<string, DirtyStockChange>;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export interface DirtyStockChange {
  sku: string;
  originalStockQty: number | null;
  stockQty: number | "";
}

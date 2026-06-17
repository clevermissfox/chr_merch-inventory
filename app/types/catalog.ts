export interface CatalogConflictGroup {
  productId: string;
  displayName: string;
  count: number;
}

export interface CatalogRow {
  rowType: "variant";
  parentProductId: string;

  productId: string;
  variantId: string;
  wooVariantId: string | null;
  sku: string;
  productName: string;
  color: string | null;
  design: string | null;
  designVariant: string | null;
  size: string | null;
  dimensions: string | null;
  priceDollars: string;
  priceVariant: string | null;
  priceCents: string;
  stockQty: number | null;
  wooStock: number | null;
  imageVariant: string | null;
  descriptionVariant: string | null;
  baseWeightOz: string | null;
  weightOzVariant: string | null;
  rowId: string | null;
  lastWooOrder: string | null;
  readableName: string | null;
  variantDetails: string | null;

  label: string;
}

export interface CatalogGroup {
  productId: string;
  wooId: string | null;
  readableName: string | null;
  productName: string;
  displayName: string;
  design: string | null;
  styleModifier: string | null;
  basePriceDollars: string;
  stockQty: number | null;
  wooStock: number | null;
  category: string;
  categoryCode: string;
  subcategory: string;
  subcategoryCode: string;
  primaryImage: string | null;
  primaryDescription: string | null;
  shortDescription: string | null;
  weightOz: string | null;
  dimensionsWidth: string | null;
  dimensionsHeight: string | null;
  dimensionsDepth: string | null;
  sku: string;
  rowId: string | null;
  lastHash: string | null;
  lastSyncedAt: string | null;

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

export interface ProductSheetRow {
  product_id: string;
  woo_id: string;
  readable_name: string;
  product_name: string;
  display_name: string;
  design: string;
  style_modifier: string;
  base_price_dollars: string;
  stock_qty: string;
  woo_stock: string;
  category: string;
  category_code: string;
  subcategory: string;
  subcategory_code: string;
  primary_image: string;
  primary_description: string;
  short_description: string;
  weight_oz: string;
  dimensions_width: string;
  dimensions_height: string;
  dimensions_depth: string;
  sku: string;
  row_id: string;
  last_hash: string;
  last_synced_at: string;
}

export interface VariantSheetRow {
  product_id: string;
  variant_id: string;
  woo_variant_id: string;
  sku: string;
  product_name: string;
  color: string;
  design: string;
  design_variant: string;
  size: string;
  dimensions: string;
  price_dollars: string;
  price_variant: string;
  price_cents: string;
  stock_qty: string;
  woo_stock: string;
  image_variant: string;
  description_variant: string;
  base_weight_oz: string;
  weight_oz_variant: string;
  row_id: string;
  last_woo_order: string;
  readable_name: string;
  variant_details: string;
}

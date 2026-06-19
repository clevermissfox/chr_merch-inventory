import type {
  CatalogConflictGroup,
  CatalogGroup,
  CatalogPayload,
  CatalogRow,
  ProductSheetRow,
  VariantSheetRow,
} from "~/types/catalog";

export function rowsToObjects<T>(rawValues: string[][]): T[] {
  if (!rawValues?.length) return [];

  const headers = rawValues[0].map((h) => h.trim());

  return rawValues.slice(1).map((row) => {
    const obj: Record<string, string> = {};

    headers.forEach((header, index) => {
      obj[header] = row[index] ?? "";
    });

    return obj as T;
  });
}

function toNullableString(value: string | undefined): string | null {
  const normalized = (value ?? "").trim();
  return normalized ? normalized : null;
}

function toNullableNumber(value: string | undefined): number | null {
  const normalized = (value ?? "").trim();
  if (!normalized) return null;

  const cleaned = normalized.replace(/[$,\s]/g, "");
  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
}

function buildCatalogRow(row: VariantSheetRow): CatalogRow {
  const label =
    row.variant_details?.trim() ||
    [row.color?.trim(), row.size?.trim()].filter(Boolean).join(" / ") ||
    row.sku;

  return {
    rowType: "variant",
    parentProductId: row.product_id,

    productId: row.product_id,
    variantId: row.variant_id,
    wooVariantId: toNullableString(row.woo_variant_id),
    sku: row.sku,
    productName: row.product_name,
    color: toNullableString(row.color),
    design: toNullableString(row.design),
    designVariant: toNullableString(row.design_variant),
    size: toNullableString(row.size),
    dimensions: toNullableString(row.dimensions),
    priceDollars: row.price_dollars,
    priceVariant: toNullableString(row.price_variant),
    priceCents: row.price_cents,
    stockQty: toNullableNumber(row.stock_qty),
    wooStock: toNullableNumber(row.woo_stock),
    imageVariant: toNullableString(row.image_variant),
    descriptionVariant: toNullableString(row.description_variant),
    baseWeightOz: toNullableString(row.base_weight_oz),
    weightOzVariant: toNullableString(row.weight_oz_variant),
    rowId: toNullableString(row.row_id),
    lastWooOrder: toNullableString(row.last_woo_order),
    readableName: toNullableString(row.readable_name),
    variantDetails: toNullableString(row.variant_details),

    label,
  };
}

function buildCatalogGroup(product: ProductSheetRow): CatalogGroup {
  return {
    productId: product.product_id,
    wooId: toNullableString(product.woo_id),
    readableName: toNullableString(product.readable_name),
    productName: product.product_name,
    displayName:
      product.display_name?.trim() ||
      product.product_name?.trim() ||
      product.readable_name?.trim() ||
      product.product_id,
    design: toNullableString(product.design),
    styleModifier: toNullableString(product.style_modifier),
    basePriceDollars: product.base_price_dollars,
    stockQty: toNullableNumber(product.stock_qty),
    wooStock: toNullableNumber(product.woo_stock),
    category: product.category,
    categoryCode: product.category_code,
    subcategory: product.subcategory,
    subcategoryCode: product.subcategory_code,
    primaryImage: toNullableString(product.primary_image),
    primaryDescription: toNullableString(product.primary_description),
    shortDescription: toNullableString(product.short_description),
    weightOz: toNullableString(product.weight_oz),
    dimensionsWidth: toNullableString(product.dimensions_width),
    dimensionsHeight: toNullableString(product.dimensions_height),
    dimensionsDepth: toNullableString(product.dimensions_depth),
    sku: product.sku,
    rowId: product.row_id,
    lastHash: toNullableString(product.last_hash),
    lastSyncedAt: toNullableString(product.last_synced_at),

    rowCount: 0,
    rows: [],
  };
}

export function buildConflictGroups(groups: CatalogGroup[]): CatalogConflictGroup[] {
  return groups
    .map((group) => {
      const count = group.rows.filter(
        (row) => row.stockQty !== row.wooStock,
      ).length;

      if (count <= 0) return null;

      return {
        productId: group.productId,
        displayName: group.displayName,
        count,
      };
    })
    .filter((group): group is CatalogConflictGroup => group !== null);
}

export function shapeToCatalogPayload(
  productRows: ProductSheetRow[],
  variantRows: VariantSheetRow[],
): CatalogPayload {
  const groupsMap = new Map<string, CatalogGroup>();

  for (const product of productRows) {
    const productId = product.product_id?.trim();
    if (!productId) continue;

    groupsMap.set(productId, buildCatalogGroup(product));
  }

  for (const variant of variantRows) {
    const parentProductId = variant.product_id?.trim();
    if (!parentProductId) continue;

    const group = groupsMap.get(parentProductId);
    if (!group) continue;

    group.rows.push(buildCatalogRow(variant));
  }

  const groups = Array.from(groupsMap.values()).map((group) => {
    group.rows.sort(compareCatalogRows);
    group.rowCount = group.rows.length;
    return group;
  });

  const conflictGroups = buildConflictGroups(groups);

  const unsyncedCount = groups.reduce((total, group) => {
    return (
      total + group.rows.filter((row) => row.stockQty !== row.wooStock).length
    );
  }, 0);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      productCount: groups.length,
      groupCount: groups.length,
      rowCount: groups.reduce((total, group) => total + group.rowCount, 0),
      unsyncedCount,
      conflictGroups,
    },
    groups,
  };
}

const SIZE_ORDER: Record<string, number> = {
  "x-small": 1,
  small: 2,
  medium: 3,
  large: 4,
  "x-large": 5,
  "xx-large": 6,
  "xxx-large": 7,
  "one size": 8,
  "no size": 9,
};

function normalizeSortValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getSizeRank(size: string | null | undefined): number {
  return SIZE_ORDER[normalizeSortValue(size)] ?? 999;
}

function compareCatalogRows(a: CatalogRow, b: CatalogRow): number {
  const parentCompare = normalizeSortValue(a.parentProductId).localeCompare(
    normalizeSortValue(b.parentProductId),
  );
  if (parentCompare !== 0) return parentCompare;

  const colorCompare = normalizeSortValue(a.color).localeCompare(
    normalizeSortValue(b.color),
  );
  if (colorCompare !== 0) return colorCompare;

  const sizeRankCompare = getSizeRank(a.size) - getSizeRank(b.size);
  if (sizeRankCompare !== 0) return sizeRankCompare;

  const sizeTextCompare = normalizeSortValue(a.size).localeCompare(
    normalizeSortValue(b.size),
  );
  if (sizeTextCompare !== 0) return sizeTextCompare;

  return normalizeSortValue(a.variantId).localeCompare(
    normalizeSortValue(b.variantId),
  );
}

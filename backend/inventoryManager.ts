import { createHash } from "node:crypto";

import type { CatalogGroup, CatalogPayload, CatalogRow } from "~/types/catalog";
import type {
  StockSyncChange,
  SyncQty,
  StockSyncPlan,
  StockSyncProductPlan,
  StockSyncVariationTarget,
  StockSyncSimpleTarget,
  WooSyncResult,
  InventoryIndexState,
  InventoryIndexUpdate,
  InventoryIndexCellValue,
  RefreshWooStockResult,
  InventoryIndexWriteResult,
  InventoryIndexHashRow,
} from "~/types/inventory";

function colLetter(idx: number): string {
  let s = "";
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/* MARK: LOCAL TYPES */
export interface WooConfig {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

type WooSheetQty = number | "";

interface RefreshWooStockOptions {
  touchedSkus?: Set<string>;
  stockQtyBySku?: Map<string, SyncQty>;
}

type StockSyncMode = "standard_sync" | "resolve_conflicts" | "sync_all";

interface StockSyncRequestChange {
  sku: string;
  stockQty: number | "";
}

/**
 * Resolves the active WooCommerce configuration from environment variables.
 * Uses staging credentials unless TARGET_ENV is set to "production".
 * Throws when any required WooCommerce setting is missing.
 */
export function getWooConfig(): WooConfig {
  const isStaging = process.env.TARGET_ENV !== "production";
  const storeUrl = isStaging
    ? process.env.WOO_STAGING_URL
    : process.env.WOO_PRODUCTION_URL;
  const consumerKey = isStaging
    ? process.env.WOO_STAGING_CONSUMER_KEY
    : process.env.WOO_PROD_CONSUMER_KEY;
  const consumerSecret = isStaging
    ? process.env.WOO_STAGING_CONSUMER_SECRET
    : process.env.WOO_PROD_CONSUMER_SECRET;

  if (!storeUrl || !consumerKey || !consumerSecret) {
    throw new Error("Missing WooCommerce configuration");
  }

  return {
    storeUrl,
    consumerKey,
    consumerSecret,
  };
}

/**
 * Converts a sheet-style Woo stock value into the catalog stock format.
 * Empty string and undefined/null are treated as no stock value and returned as null.
 */
function toCatalogWooStock(value: WooSheetQty | undefined): number | null {
  return value === "" || value == null ? null : value;
}

/**
 * Returns the Woo stock value for a SKU if it exists in the lookup map.
 * Falls back to the current catalog value when the SKU is not present in the map.
 */
function getCatalogWooStock(
  sku: string,
  currentValue: number | null,
  wooQtyBySku: Map<string, WooSheetQty>,
): number | null {
  if (!wooQtyBySku.has(sku)) return currentValue;
  return toCatalogWooStock(wooQtyBySku.get(sku));
}

/**
 * Builds a WooCommerce REST API URL with authentication query parameters.
 * Normalizes the path and optionally appends additional query string values.
 */
export function buildWooUrl(
  woo: WooConfig,
  path: string,
  query?: Record<string, string>,
): string {
  const url = new URL(
    `/wp-json/wc/v3/${path.replace(/^\/+/, "")}`,
    woo.storeUrl,
  );

  url.searchParams.set("consumer_key", woo.consumerKey);
  url.searchParams.set("consumer_secret", woo.consumerSecret);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

/**
 * Looks up a WooCommerce product by SKU and returns its product ID.
 * Returns null when no matching product is found.
 * Throws if the WooCommerce API request fails.
 */
async function findWooProductIdBySku(
  woo: WooConfig,
  sku: string,
): Promise<number | null> {
  const url = buildWooUrl(woo, "products", { sku });

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Woo product lookup failed for SKU ${sku}: HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as Array<{ id?: number }>;
  const id = data?.[0]?.id;

  return typeof id === "number" ? id : null;
}

/**
 * Fetches all variations for a WooCommerce variable product and maps variation SKU to variation ID.
 * Only variations with both a valid SKU and numeric ID are included.
 * Throws if the WooCommerce API request fails.
 */
async function fetchWooVariationIdMap(
  woo: WooConfig,
  productId: number,
): Promise<Map<string, number>> {
  const url = buildWooUrl(woo, `products/${productId}/variations`, {
    per_page: "100",
  });

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `Woo variation lookup failed for product ${productId}: HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as Array<{
    id?: number;
    sku?: string;
  }>;

  const map = new Map<string, number>();

  for (const item of data) {
    const sku = String(item?.sku || "").trim();
    const id = item?.id;

    if (!sku || typeof id !== "number") continue;
    map.set(sku, id);
  }

  return map;
}

/**
 * Builds the standard WooCommerce stock update payload for a stock-managed item.
 * Sets stock status to instock when quantity is greater than zero, otherwise outofstock.
 */
function buildWooStockPayload(qty: number) {
  return {
    manage_stock: true,
    stock_quantity: qty,
    stock_status: qty > 0 ? "instock" : "outofstock",
    backorders: "no",
  };
}

/**
 * Updates stock for a WooCommerce product or variation at the provided API path.
 * Sends a PUT request using the normalized stock payload.
 * Throws with response details when the update fails.
 */
async function putWooStock(
  woo: WooConfig,
  path: string,
  qty: number,
): Promise<void> {
  const url = buildWooUrl(woo, path);
  const payload = buildWooStockPayload(qty);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Woo stock update failed for ${path}: HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }
}

/**
 * Syncs a simple product stock target to WooCommerce.
 * Resolves the Woo product ID from the plan, target, or parent SKU lookup when needed.
 * Returns a skip reason string when the target cannot be synced; otherwise returns null.
 */
async function syncSimpleTargetToWoo(
  woo: WooConfig,
  plan: StockSyncProductPlan,
  target: StockSyncSimpleTarget,
): Promise<string | null> {
  if (target.qty === null) {
    return `Blank stock quantity for SKU ${target.sku}`;
  }

  let productId = Number(plan.wooId || target.wooId || 0);

  if (!productId) {
    productId = (await findWooProductIdBySku(woo, target.parentSku)) || 0;
  }

  if (!productId) {
    return `Missing Woo product ID for SKU ${target.sku}`;
  }

  await putWooStock(woo, `products/${productId}`, target.qty);
  return null;
}

/**
 * Syncs variation stock targets for a variable product to WooCommerce.
 * Updates the parent variable product stock status based on whether any targeted variation is in stock.
 * Returns a list of skipped variation SKUs with reasons for any targets that could not be updated.
 */
async function syncVariationTargetsToWoo(
  woo: WooConfig,
  plan: StockSyncProductPlan,
  targets: StockSyncVariationTarget[],
): Promise<Array<{ sku: string; reason: string }>> {
  const skipped: Array<{ sku: string; reason: string }> = [];

  let productId = Number(plan.wooId || 0);

  if (!productId) {
    productId = (await findWooProductIdBySku(woo, plan.parentSku)) || 0;
  }

  if (!productId) {
    for (const target of targets) {
      skipped.push({
        sku: target.sku,
        reason: `Missing Woo parent product ID for parent SKU ${plan.parentSku}`,
      });
    }
    return skipped;
  }

  const targetedQtys = targets
    .map((target) => target.qty)
    .filter((qty): qty is number => qty !== null);

  const anyInStock = targetedQtys.some((qty) => qty > 0);

  await putWooParentVariableStockStatus(woo, productId, anyInStock);

  const needsLookup = targets.some(
    (target) => !Number(target.wooVariantId || 0),
  );
  const variationIdMap = needsLookup
    ? await fetchWooVariationIdMap(woo, productId)
    : new Map<string, number>();

  for (const target of targets) {
    if (target.qty === null) {
      skipped.push({
        sku: target.sku,
        reason: `Blank stock quantity for SKU ${target.sku}`,
      });
      continue;
    }

    let variationId = Number(target.wooVariantId || 0);

    if (!variationId) {
      variationId = variationIdMap.get(target.sku) || 0;
    }

    if (!variationId) {
      skipped.push({
        sku: target.sku,
        reason: `Missing Woo variation ID for SKU ${target.sku}`,
      });
      continue;
    }

    await putWooStock(
      woo,
      `products/${productId}/variations/${variationId}`,
      target.qty,
    );
  }

  return skipped;
}

/**
 * Executes a stock sync plan against WooCommerce.
 * Attempts to update all simple and variation targets, tracks updated SKUs, and records skipped items.
 * Returns an aggregate sync result describing what was updated and what was skipped.
 */
export async function syncStockSyncPlanToWoo(
  plan: StockSyncPlan,
): Promise<WooSyncResult> {
  const woo = getWooConfig();
  const skipped: Array<{ sku: string; reason: string }> = [
    ...plan.skipped.map((item) => ({
      sku: item.sku,
      reason: item.reason,
    })),
  ];

  let updatedProducts = 0;
  const updatedSkus: string[] = [];

  for (const productPlan of plan.products) {
    let touchedThisProduct = false;

    if (productPlan.simpleTarget) {
      const error = await syncSimpleTargetToWoo(
        woo,
        productPlan,
        productPlan.simpleTarget,
      );

      if (error) {
        skipped.push({
          sku: productPlan.simpleTarget.sku,
          reason: error,
        });
      } else {
        updatedSkus.push(productPlan.simpleTarget.sku);
        touchedThisProduct = true;
      }
    }

    if (productPlan.variationTargets.length > 0) {
      const variationSkips = await syncVariationTargetsToWoo(
        woo,
        productPlan,
        productPlan.variationTargets,
      );

      const skippedSet = new Set(variationSkips.map((item) => item.sku));

      for (const target of productPlan.variationTargets) {
        if (!skippedSet.has(target.sku)) {
          updatedSkus.push(target.sku);
          touchedThisProduct = true;
        }
      }

      skipped.push(...variationSkips);
    }

    if (touchedThisProduct) {
      updatedProducts += 1;
    }
  }

  return {
    ok: true,
    updatedProducts,
    updatedSkus,
    skipped,
  };
}

/**
 * Builds a SKU-to-quantity map from raw stock sync changes.
 * Ignores entries with blank SKUs and normalizes each stock quantity before storing it.
 */
function buildInventoryStockChangeMap(
  changes: StockSyncChange[],
): Map<string, SyncQty> {
  const map = new Map<string, SyncQty>();

  for (const item of changes) {
    const sku = String(item?.sku || "").trim();
    if (!sku) continue;

    const qty = normalizeSyncQty(item?.stockQty);
    map.set(sku, qty);
  }

  return map;
}

/**
 * Builds inventory_index updates from Woo stock values and optional stock quantity values.
 * Can build updates for the full Woo stock map or only a specified set of touched SKUs.
 * Always writes last_sync_at and includes stock_qty when a stock quantity map is provided.
 */
export function buildInventoryIndexUpdates(
  wooQtyBySku: Map<string, WooSheetQty>,
  now: string,
  options: RefreshWooStockOptions = {},
): InventoryIndexUpdate[] {
  const updates: InventoryIndexUpdate[] = [];
  const { touchedSkus, stockQtyBySku } = options;

  for (const [sku, wooStock] of wooQtyBySku.entries()) {
    if (touchedSkus && !touchedSkus.has(sku)) continue;

    const fields: InventoryIndexUpdate["fields"] = {
      woo_stock: wooStock,
      last_sync_at: now,
    };

    if (stockQtyBySku && stockQtyBySku.has(sku)) {
      const stockQty = stockQtyBySku.get(sku);
      fields.stock_qty = stockQty == null ? "" : stockQty;
    }

    updates.push({ sku, fields });
  }

  // Write stock_qty for dirty SKUs with no Woo presence (e.g. draft/unpublished products).
  // No woo_stock or last_sync_at — those only apply once the product is on the site.
  if (stockQtyBySku) {
    for (const [sku, stockQty] of stockQtyBySku.entries()) {
      if (wooQtyBySku.has(sku)) continue; // already handled above
      if (touchedSkus && !touchedSkus.has(sku)) continue;
      updates.push({
        sku,
        fields: { stock_qty: stockQty == null ? "" : stockQty },
      });
    }
  }

  return updates;
}

/**
 * Refreshes WooCommerce stock values for catalog groups and writes them into the inventory index sheet.
 * Can operate on the full catalog or only a specified set of touched SKUs.
 * Optionally writes stock_qty alongside confirmed woo_stock values when provided.
 */
export async function refreshWooStockForCatalog(
  sheets: any,
  spreadsheetId: string,
  groups: CatalogGroup[],
  options: RefreshWooStockOptions = {},
): Promise<RefreshWooStockResult> {
  const woo = getWooConfig();
  const wooQtyBySku = new Map<string, WooSheetQty>();
  const { touchedSkus } = options;

  let simpleCount = 0;
  let variationCount = 0;

  for (const group of groups) {
    if (group.rows.length > 0) {
      const parentSku = String(group.sku || "").trim();
      if (!parentSku) continue;

      const matchingRows = touchedSkus
        ? group.rows.filter((row) =>
            touchedSkus.has(String(row.sku || "").trim()),
          )
        : group.rows;

      if (!matchingRows.length) continue;

      let productId = Number(group.wooId || 0);

      if (!productId) {
        const product = await fetchWooProductBySku(woo, parentSku);
        productId = product?.id || 0;
      }

      if (!productId) continue;

      const variationStockMap = await fetchAllWooVariationStockQtyBySku(
        woo,
        productId,
      );

      for (const row of matchingRows) {
        variationCount += 1;
        wooQtyBySku.set(row.sku, variationStockMap.get(row.sku) ?? "");
      }

      continue;
    }

    const sku = String(group.sku || "").trim();
    if (!sku) continue;
    if (touchedSkus && !touchedSkus.has(sku)) continue;

    const product = await fetchWooProductBySku(woo, sku);
    simpleCount += 1;
    wooQtyBySku.set(sku, toWooSheetValue(product?.stock_quantity));
  }

  let inventoryIndexState = await loadInventoryIndexState(
    sheets,
    spreadsheetId,
  );

  // Extract warehouse stock_qty values BEFORE any writes, so we can
  // patch catalog groups whose products sheet stock_qty is unpopulated.
  const warehouseStockBySku = new Map<string, number | null>();
  const stockQtyCol = inventoryIndexState.headerIndex["stock_qty"];
  if (stockQtyCol != null) {
    for (let i = 1; i < inventoryIndexState.rawValues.length; i++) {
      const row = inventoryIndexState.rawValues[i];
      const sku = String(row[inventoryIndexState.headerIndex.sku] ?? "").trim();
      if (!sku) continue;
      const raw = row[stockQtyCol];
      const qty = raw === "" || raw == null ? null : Number(raw);
      warehouseStockBySku.set(sku, isNaN(qty as number) ? null : qty);
    }
  }

  const now = new Date().toISOString();

  const updates = buildInventoryIndexUpdates(wooQtyBySku, now, options);
  const catalogNameBySku = buildCatalogNameBySku(groups);

  inventoryIndexState = await ensureInventoryIndexRowsExist(
    sheets,
    spreadsheetId,
    inventoryIndexState,
    updates,
    catalogNameBySku,
  );

  const writeResult = await writeInventoryIndexUpdates(
    sheets,
    spreadsheetId,
    inventoryIndexState,
    updates,
  );

  return {
    ok: true,
    updated: writeResult.updatedCount,
    simpleCount,
    variationCount,
    wooQtyBySku,
    warehouseStockBySku,
  };
}

/**
 * Builds a stock sync plan by matching incoming stock changes to catalog groups and rows.
 * Separates simple product targets from variation targets and records unmatched or non-editable SKUs as skipped.
 * Returns the normalized change map, planned product updates, and skipped items.
 */
export function buildStockSyncPlan(
  groups: CatalogGroup[],
  changes: StockSyncChange[],
): StockSyncPlan {
  const changeMap = buildInventoryStockChangeMap(changes);

  const productsBySimpleSku = new Map<string, CatalogGroup>();
  const variantsBySku = new Map<
    string,
    { group: CatalogGroup; row: CatalogRow }
  >();
  const variableParentSkus = new Set<string>();

  for (const group of groups) {
    const parentSku = String(group.sku || "").trim();

    if (group.rows.length > 0) {
      if (parentSku) variableParentSkus.add(parentSku);

      for (const row of group.rows) {
        const sku = String(row.sku || "").trim();
        if (!sku) continue;
        variantsBySku.set(sku, { group, row });
      }
    } else {
      if (!parentSku) continue;
      productsBySimpleSku.set(parentSku, group);
    }
  }

  const planByProductId = new Map<string, StockSyncProductPlan>();
  const skipped: StockSyncPlan["skipped"] = [];

  for (const [sku, qty] of changeMap.entries()) {
    const variantMatch = variantsBySku.get(sku);

    if (variantMatch) {
      const { group, row } = variantMatch;

      // No woo_id — nothing to sync regardless of published status
      if (!group.wooId) {
        skipped.push({
          sku,
          reason: group.publishedStatus === "draft" ? "draft_unpublished" : "no_woo_id",
        });
        continue;
      }

      const existing = planByProductId.get(group.productId) ?? {
        productId: group.productId,
        parentSku: group.sku,
        wooId: group.wooId,
        productName: group.displayName || group.productName,
        simpleTarget: null,
        variationTargets: [],
      };

      existing.variationTargets.push({
        rowType: "variant",
        sku,
        qty,
        productId: group.productId,
        parentSku: group.sku,
        wooId: group.wooId,
        variantId: row.variantId || null,
        wooVariantId: row.wooVariantId || null,
        label: row.label,
      });

      planByProductId.set(group.productId, existing);
      continue;
    }

    const simpleMatch = productsBySimpleSku.get(sku);

    if (simpleMatch) {
      // No woo_id — nothing to sync regardless of published status
      if (!simpleMatch.wooId) {
        skipped.push({
          sku,
          reason: simpleMatch.publishedStatus === "draft" ? "draft_unpublished" : "no_woo_id",
        });
        continue;
      }

      const existing = planByProductId.get(simpleMatch.productId) ?? {
        productId: simpleMatch.productId,
        parentSku: simpleMatch.sku,
        wooId: simpleMatch.wooId,
        productName: simpleMatch.displayName || simpleMatch.productName,
        simpleTarget: null,
        variationTargets: [],
      };

      existing.simpleTarget = {
        rowType: "product",
        sku,
        qty,
        productId: simpleMatch.productId,
        parentSku: simpleMatch.sku,
        wooId: simpleMatch.wooId,
        label: "Main product",
      };

      planByProductId.set(simpleMatch.productId, existing);
      continue;
    }

    if (variableParentSkus.has(sku)) {
      skipped.push({
        sku,
        reason: "variable_parent_not_editable",
      });
      continue;
    }

    skipped.push({
      sku,
      reason: "not_found",
    });
  }

  return {
    changeMap,
    products: Array.from(planByProductId.values()),
    skipped,
    updatedSkus: Array.from(changeMap.keys()),
  };
}

/**
 * Builds the stock payload used for a WooCommerce variable parent product.
 * Parent products do not manage stock directly, so only stock status is updated.
 */
function buildWooParentVariableStockPayload(anyInStock: boolean) {
  return {
    manage_stock: false,
    stock_status: anyInStock ? "instock" : "outofstock",
    backorders: "no",
  };
}

/**
 * Updates the stock status of a WooCommerce variable parent product.
 * Marks the parent as instock when any child variation is in stock, otherwise outofstock.
 * Throws with response details when the update fails.
 */
async function putWooParentVariableStockStatus(
  woo: WooConfig,
  productId: number,
  anyInStock: boolean,
): Promise<void> {
  const url = buildWooUrl(woo, `products/${productId}`);
  const payload = buildWooParentVariableStockPayload(anyInStock);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Woo parent stock update failed for woo_id=${productId}: HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }
}

/**
 * Converts a catalog-style stock value into the value format written back to the sheet.
 * Null and undefined are represented as an empty string.
 */
function toWooSheetValue(value: number | null | undefined): WooSheetQty {
  return value == null ? "" : value;
}

/**
 * Fetches a WooCommerce product by SKU and returns its ID and stock quantity.
 * Returns null when no matching product is found.
 * Throws with response details when the lookup fails.
 */
async function fetchWooProductBySku(
  woo: WooConfig,
  sku: string,
): Promise<{
  id: number;
  stock_quantity: number | null;
} | null> {
  const url = buildWooUrl(woo, "products", { sku });

  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Woo product lookup failed for SKU ${sku}: HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as Array<{
    id?: number;
    stock_quantity?: number | null;
  }>;

  const item = data?.[0];
  if (!item || typeof item.id !== "number") return null;

  return {
    id: item.id,
    stock_quantity:
      typeof item.stock_quantity === "number" ? item.stock_quantity : null,
  };
}

/**
 * Fetches all variation stock quantities for a WooCommerce variable product.
 * Paginates through variation results and returns a map of variation SKU to sheet-formatted stock quantity.
 * Throws with response details when any page request fails.
 */
async function fetchAllWooVariationStockQtyBySku(
  woo: WooConfig,
  productId: number,
): Promise<Map<string, WooSheetQty>> {
  const result = new Map<string, WooSheetQty>();
  let page = 1;

  while (true) {
    const url = buildWooUrl(woo, `products/${productId}/variations`, {
      per_page: "100",
      page: String(page),
    });

    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Woo variation lookup failed for product ${productId}: HTTP ${response.status}: ${text.slice(0, 300)}`,
      );
    }

    const data = (await response.json()) as Array<{
      sku?: string;
      stock_quantity?: number | null;
    }>;

    for (const item of data) {
      const sku = String(item?.sku || "").trim();
      if (!sku) continue;

      result.set(
        sku,
        typeof item.stock_quantity === "number" ? item.stock_quantity : "",
      );
    }

    if (data.length < 100) break;
    page += 1;
  }

  return result;
}

/**
 * Applies WooCommerce stock values from a SKU lookup map onto catalog groups.
 * Updates both simple products and variant rows while preserving existing values for SKUs not present in the map.
 */
export function applyWooStockMapToCatalogGroups(
  groups: CatalogGroup[],
  wooQtyBySku: Map<string, WooSheetQty>,
): CatalogGroup[] {
  return groups.map((group): CatalogGroup => {
    if (group.rows.length > 0) {
      const nextRows: CatalogRow[] = group.rows.map(
        (row): CatalogRow => ({
          ...row,
          wooStock: getCatalogWooStock(row.sku, row.wooStock, wooQtyBySku),
        }),
      );

      return {
        ...group,
        rows: nextRows,
      };
    }

    return {
      ...group,
      wooStock: getCatalogWooStock(group.sku, group.wooStock, wooQtyBySku),
    };
  });
}

/**
 * Loads the inventory_index sheet state needed for targeted cell updates.
 * Parses headers, builds a header index, and maps SKU values to their sheet row numbers.
 * Throws when the sheet is empty or the required sku header is missing.
 */
export async function loadInventoryIndexState(
  sheets: any,
  spreadsheetId: string,
): Promise<InventoryIndexState> {
  const sheetName = "inventory_index";
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });

  const rawValues = (response.data.values ?? []) as string[][];
  if (!rawValues.length) {
    throw new Error(`${sheetName} is empty`);
  }

  const headers = rawValues[0].map((value) => String(value || "").trim());
  const headerIndex: Record<string, number> = {};

  headers.forEach((header, index) => {
    if (header) headerIndex[header] = index;
  });

  if (headerIndex.sku == null) {
    throw new Error(`${sheetName} is missing header: sku`);
  }

  const skuToRowNumber = new Map<string, number>();

  for (let i = 1; i < rawValues.length; i += 1) {
    const row = rawValues[i];
    const sku = String(row[headerIndex.sku] || "").trim();
    if (!sku) continue;

    skuToRowNumber.set(sku, i + 1);
  }

  return {
    sheetName,
    rawValues,
    headers,
    headerIndex,
    skuToRowNumber,
  };
}

/**
 * Builds Google Sheets batch update payload entries for inventory index cell writes.
 * Converts each update field into a single-cell A1 range write based on the loaded sheet state.
 * Throws when a required target column header is missing.
 */
function buildInventoryIndexWriteData(
  state: InventoryIndexState,
  updates: InventoryIndexUpdate[],
): Array<{
  range: string;
  majorDimension: "ROWS";
  values: InventoryIndexCellValue[][];
}> {
  const data: Array<{
    range: string;
    majorDimension: "ROWS";
    values: InventoryIndexCellValue[][];
  }> = [];

  for (const update of updates) {
    const sku = String(update.sku || "").trim();
    if (!sku) continue;

    const rowNumber = state.skuToRowNumber.get(sku);
    if (!rowNumber) continue;

    for (const [fieldName, fieldValue] of Object.entries(update.fields)) {
      const columnIndex = state.headerIndex[fieldName];
      if (columnIndex == null) {
        throw new Error(`inventory_index is missing header: ${fieldName}`);
      }

      data.push({
        range: toA1Cell(state.sheetName, rowNumber, columnIndex + 1),
        majorDimension: "ROWS",
        values: [[fieldValue]],
      });
    }
  }

  return data;
}

/**
 * Writes inventory index updates for SKUs that already exist in the index sheet.
 * Skips missing SKUs, performs a batch cell update for writeable entries, and returns write statistics.
 */
export async function writeInventoryIndexUpdates(
  sheets: any,
  spreadsheetId: string,
  state: InventoryIndexState,
  updates: InventoryIndexUpdate[],
): Promise<InventoryIndexWriteResult> {
  const missingSkus: string[] = [];
  const writeableUpdates: InventoryIndexUpdate[] = [];

  for (const update of updates) {
    const sku = String(update.sku || "").trim();
    if (!sku) continue;

    if (!state.skuToRowNumber.has(sku)) {
      missingSkus.push(sku);
      continue;
    }

    writeableUpdates.push(update);
  }

  const data = buildInventoryIndexWriteData(state, writeableUpdates);

  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });
  }

  return {
    updatedCount: writeableUpdates.length,
    missingSkus,
  };
}

/**
 * Appends new rows to the inventory index sheet using the current header order.
 * Populates the sku column directly and fills remaining columns from each update's fields object.
 * Returns the number of rows appended.
 */
async function appendInventoryIndexRows(
  sheets: any,
  spreadsheetId: string,
  state: InventoryIndexState,
  rows: InventoryIndexUpdate[],
): Promise<number> {
  if (!rows.length) return 0;

  const orderedHeaders = state.headers;
  const values = rows.map((row) =>
    orderedHeaders.map((header) => {
      if (header === "sku") return row.sku;
      return row.fields[header] ?? "";
    }),
  );

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: state.sheetName,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values,
    },
  });

  return rows.length;
}

/**
 * Ensures a single SKU has a row in inventory_index. Used after product/variant creation
 * so the SKU appears immediately without waiting for a stock sync to trigger the row.
 */
export async function ensureSkuInInventoryIndex(
  sheets: any,
  spreadsheetId: string,
  sku: string,
  productName: string,
): Promise<void> {
  const state = await loadInventoryIndexState(sheets, spreadsheetId);
  if (state.skuToRowNumber.has(sku)) return;

  // Re-check the live SKU column to guard against concurrent writes
  const skuCol = colLetter(state.headerIndex.sku);
  const freshResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${state.sheetName}!${skuCol}:${skuCol}`,
  });
  const freshSkus = new Set(
    ((freshResponse.data.values ?? []) as string[][])
      .slice(1)
      .map((r) => String(r[0] ?? "").trim())
      .filter(Boolean),
  );
  if (freshSkus.has(sku)) return;

  await appendInventoryIndexRows(sheets, spreadsheetId, state, [
    { sku, fields: { product_name: productName } },
  ]);
}

/**
 * Ensures every SKU referenced by the pending updates exists in the inventory index sheet.
 * Appends missing rows with a best-available product name and then reloads sheet state.
 * Returns the original state when no rows need to be added.
 */
export async function ensureInventoryIndexRowsExist(
  sheets: any,
  spreadsheetId: string,
  state: InventoryIndexState,
  updates: InventoryIndexUpdate[],
  catalogNameBySku: Map<string, string>,
): Promise<InventoryIndexState> {
  const missingBySku = new Map<string, InventoryIndexUpdate>();

  for (const update of updates) {
    const sku = String(update.sku || "").trim();
    if (!sku) continue;
    if (state.skuToRowNumber.has(sku)) continue;
    if (missingBySku.has(sku)) continue;

    missingBySku.set(sku, {
      sku,
      fields: {
        product_name: catalogNameBySku.get(sku) ?? "",
        ...update.fields,
      },
    });
  }

  const missingRows = Array.from(missingBySku.values());
  if (!missingRows.length) return state;

  // Re-read just the SKU column immediately before appending to guard against
  // concurrent requests that loaded state before either had written.
  const skuCol = colLetter(state.headerIndex.sku);
  const freshResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${state.sheetName}!${skuCol}:${skuCol}`,
  });
  const freshSkus = new Set(
    ((freshResponse.data.values ?? []) as string[][])
      .slice(1)
      .map((r) => String(r[0] ?? "").trim())
      .filter(Boolean),
  );
  const dedupedRows = missingRows.filter((r) => !freshSkus.has(r.sku));
  if (!dedupedRows.length) return loadInventoryIndexState(sheets, spreadsheetId);

  await appendInventoryIndexRows(sheets, spreadsheetId, state, dedupedRows);
  return loadInventoryIndexState(sheets, spreadsheetId);
}

/**
 * Self-healing inventory_index writer — loads current state, creates any
 * missing SKU rows (ensureInventoryIndexRowsExist), then writes the given
 * fields (writeInventoryIndexUpdates). writeInventoryIndexUpdates alone
 * silently skips SKUs with no existing row, so callers that just want to
 * "write these fields, creating the row if needed" should use this instead
 * of calling the two lower-level functions separately and risking forgetting
 * the ensure step (mirrors updateDescriptionFields' single-call safety).
 */
export async function upsertInventoryIndexFields(
  sheets: any,
  spreadsheetId: string,
  updates: InventoryIndexUpdate[],
  catalogNameBySku: Map<string, string> = new Map(),
): Promise<InventoryIndexWriteResult> {
  if (!updates.length) return { updatedCount: 0, missingSkus: [] };

  let state = await loadInventoryIndexState(sheets, spreadsheetId);
  state = await ensureInventoryIndexRowsExist(
    sheets,
    spreadsheetId,
    state,
    updates,
    catalogNameBySku,
  );
  return writeInventoryIndexUpdates(sheets, spreadsheetId, state, updates);
}

/**
 * Chooses the preferred catalog display name from a readable name and fallback product name.
 * Returns the first non-empty trimmed value.
 */
function getPreferredCatalogName(
  readableName: string | null | undefined,
  productName: string | null | undefined,
): string {
  return String(readableName || "").trim() || String(productName || "").trim();
}

/**
 * Builds a SKU-to-name lookup map from catalog groups and their variant rows.
 * Products: display_name → product_name
 * Variants: readable_name → product_name + variant_details
 */
export function buildCatalogNameBySku(
  groups: CatalogGroup[],
): Map<string, string> {
  const map = new Map<string, string>();

  for (const group of groups) {
    const parentSku = String(group.sku || "").trim();

    if (parentSku) {
      const parentName =
        String(group.displayName || "").trim() ||
        String(group.productName || "").trim();
      if (parentName) {
        map.set(parentSku, parentName);
      }
    }

    for (const row of group.rows) {
      const sku = String(row.sku || "").trim();
      if (!sku) continue;

      const readableName = String(row.readableName || "").trim();
      const variantName =
        readableName ||
        [
          String(row.productName || "").trim(),
          String(row.variantDetails || "").trim(),
        ]
          .filter(Boolean)
          .join(" | ");

      if (variantName) {
        map.set(sku, variantName);
      }
    }
  }

  return map;
}

/**
 * Builds stock sync changes from the client-provided catalog snapshot.
 * Uses dirty rows for standard sync, conflicting rows for conflict resolution,
 * and every current catalog stock value for full sync.
 */
export function buildStockSyncChangesFromCatalog(
  catalog: CatalogPayload,
  dirtyBySku: Record<
    string,
    { sku: string; stockQty: number | ""; originalStockQty?: number | null }
  >,
  mode: StockSyncMode = "standard_sync",
): StockSyncRequestChange[] {
  if (mode === "resolve_conflicts") {
    return catalog.groups.flatMap((group) =>
      group.rows
        .filter((row) => row.stockQty !== row.wooStock)
        .map((row) => ({
          sku: row.sku,
          stockQty: typeof row.stockQty === "number" ? row.stockQty : "",
        })),
    );
  }

  if (mode === "sync_all") {
    return catalog.groups.flatMap((group) => {
      if (group.rows.length > 0) {
        return group.rows.map((row) => ({
          sku: row.sku,
          stockQty: typeof row.stockQty === "number" ? row.stockQty : "",
        }));
      }

      return group.sku
        ? [
            {
              sku: group.sku,
              stockQty:
                typeof group.stockQty === "number" ? group.stockQty : "",
            },
          ]
        : [];
    });
  }

  return Object.values(dirtyBySku).map((item) => ({
    sku: item.sku,
    stockQty: item.stockQty,
  }));
}

/* MARK: UTILITIES */

/**
 * Normalizes an incoming stock quantity into a valid sync quantity.
 * Blank, null, non-numeric, and negative values are treated as null.
 * Numeric values are rounded to the nearest integer.
 */
function normalizeSyncQty(value: unknown): SyncQty | null {
  if (value === "" || value == null) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.round(parsed);
}

/**
 * Converts a 1-based sheet column number into A1-style column letters.
 * For example, 1 becomes A and 27 becomes AA.
 */
function columnNumberToLetters(columnNumber: number): string {
  let temp = columnNumber;
  let letters = "";

  while (temp > 0) {
    const remainder = (temp - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    temp = Math.floor((temp - 1) / 26);
  }

  return letters;
}

/**
 * Builds an A1 notation cell reference for a specific sheet, row, and column.
 * Returns a fully qualified reference such as 'inventory_index'!B2.
 */
function toA1Cell(
  sheetName: string,
  rowNumber: number,
  columnNumber: number,
): string {
  return `'${sheetName}'!${columnNumberToLetters(columnNumber)}${rowNumber}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildInventoryIndexHashInput(row: InventoryIndexHashRow) {
  return {
    sku: String(row.sku || "").trim(),
    stock_qty: normalizeSyncQty(row.stock_qty),
    woo_stock: normalizeSyncQty(row.woo_stock),
  };
}

function computeInventoryIndexLastHash(row: InventoryIndexHashRow): string {
  return sha256Hex(JSON.stringify(buildInventoryIndexHashInput(row)));
}

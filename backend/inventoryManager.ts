import type { CatalogGroup, CatalogRow } from "~/types/catalog";
import type {
  StockSyncChange,
  SyncQty,
  StockSyncPlan,
  StockSyncProductPlan,
  StockSyncVariationTarget,
  StockSyncSimpleTarget,
  WooSyncResult,
  InventoryIndexSheetRow,
} from "~/types/inventory";
import { rowsToObjects } from "./catalogManager";

interface WooConfig {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

type WooSheetQty = number | "";
type WooCatalogQty = number | null;

interface RefreshWooStockResult {
  ok: true;
  updated: number;
  simpleCount: number;
  variationCount: number;
  wooQtyBySku: Map<string, WooSheetQty>;
}

function getWooConfig(): WooConfig {
  const isStaging = process.env.TARGET_ENV !== "production";
  const storeUrl = isStaging
    ? process.env.STAGING_SITE_URL
    : process.env.PRODUCTION_SITE_URL;
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

function toCatalogWooStock(value: WooSheetQty | undefined): number | null {
  return value === "" || value == null ? null : value;
}

function getCatalogWooStock(
  sku: string,
  currentValue: number | null,
  wooQtyBySku: Map<string, WooSheetQty>,
): number | null {
  if (!wooQtyBySku.has(sku)) return currentValue;
  return toCatalogWooStock(wooQtyBySku.get(sku));
}

function buildWooUrl(
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

function buildWooStockPayload(qty: number) {
  return {
    manage_stock: true,
    stock_quantity: qty,
    stock_status: qty > 0 ? "instock" : "outofstock",
    backorders: "no",
  };
}

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

function normalizeSyncQty(value: unknown): SyncQty | null {
  if (value === "" || value == null) return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.round(parsed);
}

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

function buildWooParentVariableStockPayload(anyInStock: boolean) {
  return {
    manage_stock: false,
    stock_status: anyInStock ? "instock" : "outofstock",
    backorders: "no",
  };
}

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

function toWooSheetValue(value: number | null | undefined): WooSheetQty {
  return value == null ? "" : value;
}

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

export async function refreshWooStockForCatalog(
  sheets: any,
  spreadsheetId: string,
  groups: CatalogGroup[],
): Promise<RefreshWooStockResult> {
  const woo = getWooConfig();
  const wooQtyBySku = new Map<string, WooSheetQty>();

  let simpleCount = 0;
  let variationCount = 0;

  for (const group of groups) {
    if (group.rows.length > 0) {
      const parentSku = String(group.sku || "").trim();
      if (!parentSku) continue;

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

      for (const row of group.rows) {
        variationCount += 1;
        wooQtyBySku.set(row.sku, variationStockMap.get(row.sku) ?? "");
      }

      continue;
    }

    const sku = String(group.sku || "").trim();
    if (!sku) continue;

    const product = await fetchWooProductBySku(woo, sku);
    simpleCount += 1;
    wooQtyBySku.set(sku, toWooSheetValue(product?.stock_quantity));
  }

  const inventoryResponse = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["inventory_index_values"],
  });

  const inventoryRanges = inventoryResponse.data.valueRanges ?? [];

  const inventoryRows = rowsToObjects<InventoryIndexSheetRow>(
    inventoryRanges[0]?.values ?? [],
  );

  const updated = await writeWooStockToNamedRangesBySku(
    sheets,
    spreadsheetId,
    inventoryRows,
    wooQtyBySku,
  );

  return {
    ok: true,
    updated,
    simpleCount,
    variationCount,
    wooQtyBySku,
  };
}

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
function buildInventoryIndexSkuPositionMap(
  inventoryRows: InventoryIndexSheetRow[],
): Map<string, number> {
  const skuToPosition = new Map<string, number>();

  inventoryRows.forEach((row, index) => {
    const sku = String(row.sku || "").trim();
    if (!sku) return;

    skuToPosition.set(sku, index + 1);
  });

  return skuToPosition;
}

async function writeWooStockToNamedRangesBySku(
  sheets: any,
  spreadsheetId: string,
  inventoryRows: InventoryIndexSheetRow[],
  wooQtyBySku: Map<string, WooSheetQty>,
): Promise<number> {
  const skuToPosition = buildInventoryIndexSkuPositionMap(inventoryRows);
  const now = new Date().toISOString();

  const data: Array<{
    range: string;
    majorDimension: "ROWS";
    values: (string | number)[][];
  }> = [];

  for (const [sku, wooStock] of wooQtyBySku.entries()) {
    const position = skuToPosition.get(sku);
    if (!position) continue;

    data.push({
      range: `inventory_index_values_woo_stock!A${position}`,
      majorDimension: "ROWS",
      values: [[wooStock]],
    });

    data.push({
      range: `inventory_index_values_last_sync!A${position}`,
      majorDimension: "ROWS",
      values: [[now]],
    });
  }

  if (!data.length) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data,
    },
  });

  return data.length / 2;
}

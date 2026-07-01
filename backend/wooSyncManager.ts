import type { sheets_v4 } from "googleapis";
import type { CatalogGroup, CatalogRow } from "~/types/catalog";
import type { InventoryIndexUpdate } from "~/types/inventory";
import {
  getWooConfig,
  buildWooUrl,
  loadInventoryIndexState,
  writeInventoryIndexUpdates,
} from "./inventoryManager";
import type { WooConfig } from "./inventoryManager";
import { colByHeader, colLetter, computeProductSyncHash } from "./catalogManager";

type SheetsClient = sheets_v4.Sheets;

const STICKER_SUBCAT_CODE = "STK";

// Parses a Woo REST API error response and returns a human-readable message
// with a suggested action where the error code is recognizable.
function humanizeWooError(
  rawText: string,
  status: number,
  context: { sku: string; operation: string; isVariation?: boolean },
): string {
  let code = "";
  let wooMessage = "";
  try {
    const parsed = JSON.parse(rawText) as { code?: string; message?: string };
    code = parsed.code ?? "";
    wooMessage = parsed.message ?? "";
  } catch {
    // not JSON — fall through to raw
  }

  const { sku, operation, isVariation } = context;

  if (code === "woocommerce_rest_product_variation_invalid_id" || (status === 404 && isVariation)) {
    return (
      `Variation for SKU ${sku} not found in WooCommerce (it may have been deleted or moved to a different product). ` +
      `Fix: in the variants sheet, clear the woo_variant_id cell for SKU ${sku}, then sync again to re-create it.`
    );
  }
  if (code === "woocommerce_rest_product_invalid_id" || (status === 404 && !isVariation)) {
    return (
      `Product ${sku} not found in WooCommerce (it may have been deleted). ` +
      `Fix: in the products sheet, clear the woo_id cell for SKU ${sku}, then sync again to re-create it.`
    );
  }
  if (status === 401 || status === 403) {
    return `WooCommerce API authentication failed during ${operation} for ${sku}. Check your WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET.`;
  }
  if (status === 422 && wooMessage) {
    return `WooCommerce rejected the ${operation} for ${sku}: ${wooMessage}`;
  }
  if (status >= 500) {
    return `WooCommerce server error (HTTP ${status}) during ${operation} for ${sku}. Try again — if it persists, check the WooCommerce error log.`;
  }
  // Unknown — include the code if present so it's diagnosable
  const codeHint = code ? ` [${code}]` : "";
  return `Woo ${operation} failed for ${sku} (HTTP ${status})${codeHint}: ${(wooMessage || rawText).slice(0, 200)}`;
}

// --- Normalization helpers, ported from gas_legacy/utils.js ---

export function normalizePriceCell(
  value: string | number | null | undefined,
): string {
  if (value === "" || value == null) return "";
  if (typeof value === "number") return value.toFixed(2);
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? "" : num.toFixed(2);
}

// Sheet stores weight in oz; Woo expects lbs.
export function normalizeWeightOzToLbs(
  value: string | number | null | undefined,
): string {
  const toNum = (v: string | number | null | undefined): number => {
    if (v === "" || v == null) return 0;
    const cleaned = String(v).replace(/[^0-9.]/g, "");
    if (!cleaned) return 0;
    const num = parseFloat(cleaned);
    return Number.isNaN(num) ? 0 : num;
  };
  const oz = toNum(value);
  if (oz === 0) return "";
  return (oz / 16).toFixed(3);
}

export function normalizeDimCell(
  value: string | number | null | undefined,
): string {
  if (value === "" || value == null) return "";
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? "" : String(num);
}

interface WooVariantAttr {
  name: string;
  option: string;
}

export function variationSignature(attrs: WooVariantAttr[]): string {
  const map: Record<string, string> = {};
  for (const a of attrs) {
    const n = (a.name ?? "").trim();
    const o = (a.option ?? "").trim();
    if (n) map[n] = o;
  }
  return Object.keys(map)
    .sort()
    .map((k) => `${k}=${map[k]}`)
    .join("|");
}

function buildVariantAttrs(row: CatalogRow, isSticker: boolean): WooVariantAttr[] {
  const attrs: WooVariantAttr[] = [];
  if (!isSticker && row.color) attrs.push({ name: "Color", option: row.color });
  if (!isSticker && row.size && row.size !== "no size")
    attrs.push({ name: "Size", option: row.size });
  const designLabel =
    row.design && row.designVariant
      ? `${row.design} – ${row.designVariant}`
      : row.design || row.designVariant || "";
  if (designLabel) attrs.push({ name: "Design", option: designLabel });
  return attrs;
}

interface VariantCollision {
  productId: string;
  displayName: string;
  signature: string;
  skus: string[];
}

// Hard-stop guard: throws if two variants of the same product would resolve
// to the same Woo attribute combination — Woo can't tell them apart and
// silently clobbers one.
export function assertNoVariationAttributeCollisions(
  groups: CatalogGroup[],
): void {
  const collisions: VariantCollision[] = [];

  for (const group of groups) {
    if (!group.rows.length) continue;
    const isSticker = group.subcategoryCode === STICKER_SUBCAT_CODE;
    const seen = new Map<string, string[]>();

    for (const row of group.rows) {
      const sig = variationSignature(buildVariantAttrs(row, isSticker));
      const list = seen.get(sig) ?? [];
      list.push(row.sku);
      seen.set(sig, list);
    }

    for (const [sig, skus] of seen) {
      if (skus.length > 1) {
        collisions.push({
          productId: group.productId,
          displayName: group.displayName,
          signature: sig || "(no distinguishing attributes)",
          skus,
        });
      }
    }
  }

  if (collisions.length) {
    const detail = collisions
      .map(
        (c) =>
          `${c.displayName} (${c.productId}): ${c.skus.join(", ")} all resolve to "${c.signature}"`,
      )
      .join("; ");
    throw new Error(
      `Variant attribute collision — these SKUs would overwrite each other in Woo: ${detail}`,
    );
  }
}

// --- Payload construction ---

interface WooParentAttribute {
  name: string;
  variation: true;
  options: string[];
}

export interface WooParentPayload {
  name: string;
  sku: string;
  type: "simple" | "variable";
  status: "draft" | "publish";
  date_created_gmt?: string;
  description: string;
  short_description: string;
  categories: Array<{ id: number }>;
  attributes: WooParentAttribute[];
  weight: string;
  dimensions: { length: string; width: string; height: string };
  regular_price?: string;
  sale_price?: string;
  manage_stock?: boolean;
  stock_quantity?: number;
  stock_status?: "instock" | "outofstock";
}

export interface WooVariationPayload {
  sku: string;
  regular_price: string;
  sale_price?: string;
  description: string;
  attributes: WooVariantAttr[];
  weight: string;
  dimensions: { length: string; width: string; height: string };
  manage_stock?: boolean;
  stock_quantity?: number;
  stock_status?: "instock" | "outofstock";
}

export function buildWooParentPayload(
  group: CatalogGroup,
  categories: Array<{ id: number }>,
  isNew: boolean,
  forceStock = false,
): WooParentPayload {
  const hasVariants = group.rows.length > 0;
  const isSticker = group.subcategoryCode === STICKER_SUBCAT_CODE;
  // Always mirrors the sheet's current state — including taking a
  // previously-live product back down to draft. The `publish` flag (handled
  // by the caller) only gates whether a never-before-seen draft gets synced
  // at all; it must never force status to "publish" once a product already
  // exists in Woo, or there'd be no way to ever unpublish something.
  const status: "draft" | "publish" =
    group.publishedStatus === "draft" ? "draft" : "publish";

  const attrValues: Record<"Color" | "Size" | "Design", Set<string>> = {
    Color: new Set(),
    Size: new Set(),
    Design: new Set(),
  };
  for (const row of group.rows) {
    for (const a of buildVariantAttrs(row, isSticker)) {
      attrValues[a.name as "Color" | "Size" | "Design"]?.add(a.option);
    }
  }
  const attrOrder = (isSticker ? ["Design"] : ["Color", "Size", "Design"]) as Array<
    "Color" | "Size" | "Design"
  >;
  const attributes: WooParentAttribute[] = attrOrder
    .filter((name) => attrValues[name].size > 0)
    .map((name) => ({
      name,
      variation: true as const,
      options: Array.from(attrValues[name]),
    }));

  const payload: WooParentPayload = {
    name: group.displayName || group.productName || group.sku,
    sku: group.sku,
    type: hasVariants ? "variable" : "simple",
    status,
    // Pin the date explicitly when publishing. Without this, any clock/
    // timezone skew between this request and WordPress's "now" can make WP
    // think the post date is in the future, silently downgrading status to
    // "future" (shown as "Scheduled" in wp-admin) instead of "publish".
    ...(status === "publish"
      ? { date_created_gmt: new Date().toISOString().replace(/\.\d{3}Z$/, "") }
      : {}),
    description: group.primaryDescription || "",
    short_description: group.shortDescription || "",
    categories,
    attributes,
    weight: normalizeWeightOzToLbs(group.weightOz),
    dimensions: {
      length: normalizeDimCell(group.dimensionsDepth),
      width: normalizeDimCell(group.dimensionsWidth),
      height: normalizeDimCell(group.dimensionsHeight),
    },
  };

  if (!hasVariants) {
    payload.regular_price = normalizePriceCell(group.basePriceDollars);
    const sale = normalizePriceCell(group.salePriceDollars);
    if (sale) payload.sale_price = sale;

    // Set stock on first creation, or when an explicit override was provided
    // (e.g. the user set an initial qty in the publish/sync confirm dialog).
    if (isNew || forceStock) {
      const qty = group.stockQty ?? 0;
      payload.manage_stock = true;
      payload.stock_quantity = qty;
      payload.stock_status = qty > 0 ? "instock" : "outofstock";
    }
  } else {
    // A product can start as simple (parent-level manage_stock) and later
    // gain variants, becoming variable (per-variation stock). Explicitly
    // flip manage_stock off at the parent on every sync once it has
    // variants, so a stale "true" from its simple-product days doesn't
    // conflict with each variation's own stock management.
    payload.manage_stock = false;
  }

  return payload;
}

export function buildWooVariationPayload(
  row: CatalogRow,
  group: CatalogGroup,
  isNew: boolean,
  forceStock = false,
): WooVariationPayload {
  const isSticker = group.subcategoryCode === STICKER_SUBCAT_CODE;

  const payload: WooVariationPayload = {
    sku: row.sku,
    regular_price: normalizePriceCell(row.priceVariant || group.basePriceDollars),
    description: row.descriptionVariant || "",
    attributes: buildVariantAttrs(row, isSticker),
    weight: normalizeWeightOzToLbs(row.weightOzVariant || group.weightOz),
    dimensions: {
      length: normalizeDimCell(group.dimensionsDepth),
      width: normalizeDimCell(group.dimensionsWidth),
      height: normalizeDimCell(group.dimensionsHeight),
    },
  };

  const sale = normalizePriceCell(row.salePriceVariant || group.salePriceDollars);
  if (sale) payload.sale_price = sale;

  if (isNew || forceStock) {
    const qty = row.stockQty ?? 0;
    payload.manage_stock = true;
    payload.stock_quantity = qty;
    payload.stock_status = qty > 0 ? "instock" : "outofstock";
  }

  return payload;
}

// --- Category Woo-ID resolution ---

export interface CategoryWooIdMaps {
  catCodeToId: Map<string, number>;
  subCatCodeToId: Map<string, number>;
}

export async function loadCategoryWooIdMaps(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<CategoryWooIdMaps> {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["catCode", "catId", "subCatCode", "subCatId"],
  });
  const vrs = response.data.valueRanges ?? [];
  const flat = (i: number): string[] => (vrs[i]?.values ?? []).flat().map(String);
  const catCode = flat(0);
  const catId = flat(1);
  const subCatCode = flat(2);
  const subCatId = flat(3);

  const catCodeToId = new Map<string, number>();
  catCode.forEach((code, i) => {
    if (code && catId[i]) catCodeToId.set(code.toUpperCase(), Number(catId[i]));
  });
  const subCatCodeToId = new Map<string, number>();
  subCatCode.forEach((code, i) => {
    if (code && subCatId[i]) subCatCodeToId.set(code.toUpperCase(), Number(subCatId[i]));
  });

  return { catCodeToId, subCatCodeToId };
}

// Every product gets tagged under the shared "CHR Merch" top-level Woo
// category in addition to its own category/subcategory — ported from
// gas_legacy's catCodeToId["CHR"] injection. Hardcoded id, not looked up by
// code, since it's a fixed store-wide taxonomy term (also excluded from the
// selectable category list in DialogCreateProduct.tsx for the same reason).
const CHR_MERCH_CATEGORY_ID = 112;

export function buildWooCategoriesForGroup(
  group: CatalogGroup,
  maps: CategoryWooIdMaps,
): Array<{ id: number }> {
  const categories: Array<{ id: number }> = [];
  const catId = maps.catCodeToId.get((group.categoryCode || "").toUpperCase());
  if (catId) categories.push({ id: catId });
  const subCatId = maps.subCatCodeToId.get(
    (group.subcategoryCode || "").toUpperCase(),
  );
  if (subCatId) categories.push({ id: subCatId });
  if (!categories.some((c) => c.id === CHR_MERCH_CATEGORY_ID)) {
    categories.push({ id: CHR_MERCH_CATEGORY_ID });
  }
  return categories;
}

// --- Woo REST calls ---

async function findWooProductIdBySku(
  woo: WooConfig,
  sku: string,
): Promise<number | null> {
  const url = buildWooUrl(woo, "products", { sku });
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const list = (await res.json()) as Array<{ id: number }>;
  return list[0]?.id ?? null;
}

// Default product list/lookup excludes trashed items — Woo still reserves
// the SKU for a trashed product, so a plain SKU lookup won't explain a
// "SKU already in use" error caused by one. Only called as a fallback when
// create fails, to surface what's actually blocking it.
async function findWooProductIdBySkuAnyStatus(
  woo: WooConfig,
  sku: string,
): Promise<{ id: number; status: string } | null> {
  // WooCommerce's REST API "any" status does not reliably include trashed
  // posts — it has to be queried explicitly. Check both rather than trust
  // "any" to mean literally any status.
  for (const status of ["any", "trash"]) {
    const url = buildWooUrl(woo, "products", { sku, status });
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) continue;
    const list = (await res.json()) as Array<{ id: number; status: string }>;
    if (list[0]) return { id: list[0].id, status: list[0].status };
  }
  return null;
}

async function fetchAllWooVariationsBySku(
  woo: WooConfig,
  productId: number,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let page = 1;
  while (true) {
    const url = buildWooUrl(woo, `products/${productId}/variations`, {
      per_page: "100",
      page: String(page),
    });
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      throw new Error(
        `Failed to list Woo variations for product ${productId}: HTTP ${res.status}`,
      );
    }
    const arr = (await res.json()) as Array<{ id: number; sku?: string }>;
    if (!arr.length) break;
    for (const v of arr) {
      if (v.sku) map.set(v.sku.trim(), v.id);
    }
    if (arr.length < 100) break;
    page += 1;
  }
  return map;
}

export interface ProductSyncResult {
  productId: string;
  sku: string;
  status: "synced" | "skipped_draft" | "skipped_unchanged" | "failed" | "sku_collision_trashed";
  wooId?: number;
  trashedWooId?: number;
  variantWooIds?: Array<{ sku: string; wooVariantId: number }>;
  hash?: string;
  publishedStatus?: "draft" | "publish";
  error?: string;
}

// Syncs one product (and its variations, if any) to Woo. Creates if no Woo
// ID is known yet (falling back to a SKU lookup before creating fresh),
// otherwise updates in place. Does not touch stock — that's a separate flow.
export async function syncProductGroupToWoo(
  group: CatalogGroup,
  categoryMaps: CategoryWooIdMaps,
  publish: boolean,
  forceStockSkus: Set<string> = new Set(),
): Promise<ProductSyncResult> {
  const sheetWooId = group.wooId ? Number(group.wooId) : 0;

  // The `publish` gate only protects a product that's never existed in Woo
  // before (no wooId known by the sheet) — once it's live, syncing always
  // proceeds and reflects the sheet's current draft/publish state, including
  // taking it back down. Re-asking "are you sure you want to publish" only
  // makes sense for the first go-live, not for routine status changes to
  // something that's already live. Skipping here (before any Woo call) also
  // avoids a wasted lookup for the common case in a "sync all" run.
  if (group.publishedStatus === "draft" && !sheetWooId && !publish) {
    return { productId: group.productId, sku: group.sku, status: "skipped_draft" };
  }

  const woo = getWooConfig();
  const hasVariants = group.rows.length > 0;
  const categories = buildWooCategoriesForGroup(group, categoryMaps);

  let wooId = sheetWooId;
  if (!wooId) {
    wooId = (await findWooProductIdBySku(woo, group.sku)) ?? 0;
  }
  const isNewProduct = !wooId;

  const forceGroupStock = forceStockSkus.has(group.sku);
  const parentPayload = buildWooParentPayload(group, categories, isNewProduct, forceGroupStock);

  const url = wooId ? buildWooUrl(woo, `products/${wooId}`) : buildWooUrl(woo, "products");
  const res = await fetch(url, {
    method: wooId ? "PUT" : "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(parentPayload),
  });
  const text = await res.text();
  if (!res.ok) {
    // Creating with a SKU that belongs to a trashed (soft-deleted) Woo
    // product fails this way — Woo keeps the SKU reserved until the trashed
    // product is permanently deleted. Look it up and tell the user exactly
    // what to do instead of surfacing Woo's raw, confusing error text.
    if (!wooId && /sku/i.test(text) && /already|exist|lookup/i.test(text)) {
      const trashedMatch = await findWooProductIdBySkuAnyStatus(woo, group.sku);
      if (trashedMatch) {
        return {
          productId: group.productId,
          sku: group.sku,
          status: "sku_collision_trashed",
          trashedWooId: trashedMatch.id,
          error: `A ${trashedMatch.status} WooCommerce product with this SKU already exists (id ${trashedMatch.id}). Relink to restore it, or permanently delete it from WooCommerce Trash first.`,
        };
      }
      // No post exists under any status, yet Woo still rejects the SKU as a
      // duplicate — its internal product lookup table (wc_product_meta_lookup)
      // has a stale entry from a deletion that didn't clean up properly.
      // This isn't fixable through normal product create/update calls.
      throw new Error(
        `SKU "${group.sku}" is rejected as a duplicate, but no WooCommerce product exists with it under any status (checked trash, draft, publish — nothing found). ` +
          `This means Woo's internal product lookup table has a stale entry left over from a previous deletion. ` +
          `Fix: in WooCommerce, go to Status → Tools → "Regenerate product lookup table" (or have your host run it via WP-CLI: wp wc tool run regenerate_product_lookup_table), then try publishing again.`,
      );
    }
    throw new Error(
      humanizeWooError(text, res.status, {
        sku: group.sku,
        operation: wooId ? "product update" : "product create",
        isVariation: false,
      }),
    );
  }
  const created = JSON.parse(text || "{}") as { id?: number };
  if (!wooId) {
    if (!created.id)
      throw new Error(`Woo product create response missing id for ${group.sku}`);
    wooId = created.id;
  }

  const variantWooIds: Array<{ sku: string; wooVariantId: number }> = [];
  if (hasVariants) {
    const existingBySku = await fetchAllWooVariationsBySku(woo, wooId);
    for (const row of group.rows) {
      const existingId = row.wooVariantId
        ? Number(row.wooVariantId)
        : existingBySku.get(row.sku) ?? 0;
      const variationPayload = buildWooVariationPayload(row, group, !existingId, forceStockSkus.has(row.sku));
      const vUrl = existingId
        ? buildWooUrl(woo, `products/${wooId}/variations/${existingId}`)
        : buildWooUrl(woo, `products/${wooId}/variations`);
      const vRes = await fetch(vUrl, {
        method: existingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(variationPayload),
      });
      const vText = await vRes.text();
      if (!vRes.ok) {
        throw new Error(
          humanizeWooError(vText, vRes.status, {
            sku: row.sku,
            operation: existingId ? "variation update" : "variation create",
            isVariation: true,
          }),
        );
      }
      const vCreated = JSON.parse(vText || "{}") as { id?: number };
      const returnedId = vCreated.id ?? existingId;
      if (returnedId && String(row.wooVariantId ?? "") !== String(returnedId)) {
        variantWooIds.push({ sku: row.sku, wooVariantId: returnedId });
      }
    }
  }

  return {
    productId: group.productId,
    sku: group.sku,
    status: "synced",
    wooId,
    variantWooIds,
    hash: computeProductSyncHash(group),
    publishedStatus: parentPayload.status,
  };
}

// --- WooCommerce deletion ---

// After deleting the last variation, the parent product must be converted to
// type=simple and given manage_stock=true so WooCommerce doesn't leave it as
// a variable product with zero variations (which breaks the storefront).
export async function convertWooProductToSimple(wooId: number): Promise<void> {
  const woo = getWooConfig();
  const url = buildWooUrl(woo, `products/${wooId}`);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ type: "simple", manage_stock: true }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Woo convert-to-simple failed (${res.status}): ${text}`);
  }
}

export async function deleteProductFromWoo(wooId: number): Promise<void> {
  const woo = getWooConfig();
  const url = buildWooUrl(woo, `products/${wooId}`, { force: "true" });
  const res = await fetch(url, { method: "DELETE", headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Woo product delete failed (${res.status}): ${text}`);
  }
}

export async function deleteVariationFromWoo(wooProductId: number, wooVariationId: number): Promise<void> {
  const woo = getWooConfig();
  const url = buildWooUrl(woo, `products/${wooProductId}/variations/${wooVariationId}`, { force: "true" });
  const res = await fetch(url, { method: "DELETE", headers: { Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Woo variation delete failed (${res.status}): ${text}`);
  }
}

// --- Sheet write-back ---

export async function writeWooSyncResults(
  sheets: SheetsClient,
  spreadsheetId: string,
  results: ProductSyncResult[],
): Promise<void> {
  const synced = results.filter((r) => r.status === "synced" && r.wooId);
  if (!synced.length) return;

  const productData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });
  const pValues = productData.data.values ?? [];
  if (pValues.length < 2) return;

  const pHeaders = (pValues[0] as string[]).map((h) => String(h).trim());
  const pCol = (name: string) => colByHeader(pHeaders, name);
  const pSkuIdx = pCol("sku");
  const wooIdIdx = pCol("woo_id");
  const hashIdx = pCol("last_hash");
  const syncedAtIdx = pCol("last_synced_at");
  const publishedStatusIdx = pCol("published_status");

  const productRowBySku = new Map<string, number>();
  for (let i = 1; i < pValues.length; i++) {
    const sku = String((pValues[i] as string[])[pSkuIdx] ?? "").trim();
    if (sku) productRowBySku.set(sku, i + 1);
  }

  const now = new Date().toISOString();
  const data: Array<{ range: string; values: string[][] }> = [];

  for (const r of synced) {
    const sheetRow = productRowBySku.get(r.sku);
    if (!sheetRow) continue;
    data.push(
      { range: `products!${colLetter(wooIdIdx)}${sheetRow}`, values: [[String(r.wooId)]] },
      { range: `products!${colLetter(hashIdx)}${sheetRow}`, values: [[r.hash ?? ""]] },
      { range: `products!${colLetter(syncedAtIdx)}${sheetRow}`, values: [[now]] },
    );
    if (r.publishedStatus) {
      data.push({
        range: `products!${colLetter(publishedStatusIdx)}${sheetRow}`,
        values: [[r.publishedStatus]],
      });
    }
  }

  const variantWrites = synced.flatMap((r) => r.variantWooIds ?? []);
  if (variantWrites.length) {
    const variantData = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "variants_values",
    });
    const vValues = variantData.data.values ?? [];
    if (vValues.length >= 2) {
      const vHeaders = (vValues[0] as string[]).map((h) => String(h).trim());
      const vCol = (name: string) => colByHeader(vHeaders, name);
      const vSkuIdx = vCol("sku");
      const wooVariantIdIdx = vCol("woo_variant_id");
      const variantRowBySku = new Map<string, number>();
      for (let i = 1; i < vValues.length; i++) {
        const sku = String((vValues[i] as string[])[vSkuIdx] ?? "").trim();
        if (sku) variantRowBySku.set(sku, i + 1);
      }
      for (const vw of variantWrites) {
        const sheetRow = variantRowBySku.get(vw.sku);
        if (!sheetRow) continue;
        data.push({
          range: `variants!${colLetter(wooVariantIdIdx)}${sheetRow}`,
          values: [[String(vw.wooVariantId)]],
        });
      }
    }
  }

  if (!data.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

// --- Orchestration ---

export interface CatalogSyncSummary {
  results: ProductSyncResult[];
  syncedCount: number;
  skippedDraftCount: number;
  skippedUnchangedCount: number;
  failedCount: number;
}

// Syncs the given product groups' content to Woo (never stock). A failure on
// one product doesn't block the rest — each is independent, and since sheet
// edits are already saved before this ever runs, a failure here only means
// that product's last_hash/last_synced_at don't advance; nothing the user
// already saved is at risk.
//
// skipUnchanged: when true, a group whose current hash matches its stored
// last_hash is skipped without a Woo call — used for "sync all" so it only
// pushes what actually changed (mirrors gas_legacy's bulk sync skip logic).
// An explicit single-product sync always pushes regardless, since the user
// asked for that one specifically.
export async function syncCatalogGroupsToWoo(
  sheets: SheetsClient,
  spreadsheetId: string,
  groups: CatalogGroup[],
  publish: boolean,
  opts: { skipUnchanged?: boolean; forceStockSkus?: Set<string> } = {},
): Promise<CatalogSyncSummary> {
  assertNoVariationAttributeCollisions(groups);

  const categoryMaps = await loadCategoryWooIdMaps(sheets, spreadsheetId);
  const results: ProductSyncResult[] = [];

  for (const group of groups) {
    if (opts.skipUnchanged && group.lastHash) {
      const currentHash = computeProductSyncHash(group);
      if (currentHash === group.lastHash) {
        results.push({
          productId: group.productId,
          sku: group.sku,
          status: "skipped_unchanged",
        });
        continue;
      }
    }

    try {
      results.push(await syncProductGroupToWoo(group, categoryMaps, publish, opts.forceStockSkus));
    } catch (err: any) {
      results.push({
        productId: group.productId,
        sku: group.sku,
        status: "failed",
        error: err?.message ?? "Unknown error",
      });
    }
  }

  await writeWooSyncResults(sheets, spreadsheetId, results);

  // A product with variants manages stock per-variation in Woo — the
  // parent's own inventory_index entry (left over from when it may have
  // been a simple product) is no longer meaningful once it has variants.
  // Clear it every time, not just on the transition sync — cheap and always
  // correct, no need to detect "did this just change" separately.
  const syncedSkus = new Set(
    results.filter((r) => r.status === "synced").map((r) => r.sku),
  );
  const parentSkusToClear = groups
    .filter((g) => g.rows.length > 0 && syncedSkus.has(g.sku))
    .map((g) => g.sku);
  if (parentSkusToClear.length) {
    const invState = await loadInventoryIndexState(sheets, spreadsheetId);
    const clearUpdates: InventoryIndexUpdate[] = parentSkusToClear.map((sku) => ({
      sku,
      fields: { stock_qty: "" },
    }));
    await writeInventoryIndexUpdates(sheets, spreadsheetId, invState, clearUpdates);
  }

  return {
    results,
    syncedCount: results.filter((r) => r.status === "synced").length,
    skippedDraftCount: results.filter((r) => r.status === "skipped_draft").length,
    skippedUnchangedCount: results.filter((r) => r.status === "skipped_unchanged")
      .length,
    failedCount: results.filter((r) => r.status === "failed").length,
  };
}

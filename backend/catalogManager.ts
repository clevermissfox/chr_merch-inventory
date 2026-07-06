import { createHash } from "crypto";
import { sizeRank } from "~/utils/sizeUtils";
import { variantDupeKey } from "~/utils/variantKey";
import { isSalePriceValid } from "~/utils/priceUtils";
import {
  ensureInventoryIndexRowsExist,
  loadInventoryIndexState,
  getWooConfig,
  buildWooUrl,
} from "./inventoryManager";
import type { sheets_v4 } from "googleapis";
import type {
  CatalogConflictGroup,
  CatalogGroup,
  CatalogPayload,
  CatalogRow,
  NewProductFields,
  ProductSheetRow,
  RefData,
  VariantSheetRow,
} from "~/types/catalog";

type SheetsClient = sheets_v4.Sheets;

export interface DupeSkuConflict {
  sku: string;
  existing: { dataIndex: number; label: string };
  new: { dataIndex: number; label: string };
}

export class DupeSkuError extends Error {
  constructor(public dupes: DupeSkuConflict[]) {
    super("Duplicate SKU detected");
    this.name = "DupeSkuError";
  }
}

export function colByHeader(headers: string[], name: string): number {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error(`Sheet missing required column "${name}"`);
  return idx;
}

// Subcategory labels are the one human-facing display string in ref data —
// everything else (category/subcategory/design/color/size values) is a
// lowercase slug, and codes are uppercase. Capitalizes each space-separated
// word regardless of how the user typed it in.
export function toTitleCase(text: string): string {
  return text.replace(
    /\S+/g,
    (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
  );
}

export async function readRefData(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<RefData> {
  const namedRanges = [
    "catList",
    "catCode",
    "catId",
    "subCatList",
    "subCatCode",
    "subCatLabel",
    "subCatId",
    "subCatParentCode",
    "graphicsList",
    "graphicsVariantList",
    "graphicsVariantCode",
    "styleModList",
    "colorsList",
    "colorsCode",
    "sizesList",
    "sizesCode",
    "dimensionsList",
    "dimensionsCode",
  ];

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: namedRanges,
  });

  const vr = response.data.valueRanges ?? [];
  const flat = (i: number): string[] =>
    (vr[i]?.values ?? []).flat().map(String).filter(Boolean);

  const [
    catList,
    catCode,
    catId,
    subCatList,
    subCatCode,
    subCatLabel,
    subCatId,
    subCatParentCode,
    graphicsList,
    graphicsVariantList,
    graphicsVariantCode,
    styleModList,
    colorsList,
    colorsCode,
    sizesList,
    sizesCode,
    dimensionsList,
    dimensionsCode,
  ] = namedRanges.map((_, i) => flat(i));

  return {
    categories: catList.map((value, i) => ({
      value,
      code: catCode[i] ?? "",
      wooId: catId[i] ? Number(catId[i]) : null,
    })),
    subcategories: subCatList.map((value, i) => ({
      value,
      code: subCatCode[i] ?? "",
      label: subCatLabel[i] ?? value,
      wooId: subCatId[i] ? Number(subCatId[i]) : null,
      parentCode: subCatParentCode[i] ?? "",
    })),
    graphics: graphicsList,
    graphicsVariants: graphicsVariantList.map((value, i) => ({
      value,
      code: graphicsVariantCode[i] ?? "",
    })),
    styles: styleModList,
    colors: colorsList.map((value, i) => ({
      value,
      code: colorsCode[i] ?? "",
    })),
    sizes: sizesList.map((value, i) => ({
      value,
      code: sizesCode[i] ?? "",
    })),
    dimensions: dimensionsList.map((value, i) => ({
      value,
      code: dimensionsCode[i] ?? "",
    })),
  };
}

export type RefAddType =
  | "color"
  | "size"
  | "dimension"
  | "graphicsVariant"
  | "graphic"
  | "style";

export const VALID_REF_TYPES = new Set<RefAddType>([
  "color",
  "size",
  "dimension",
  "graphicsVariant",
  "graphic",
  "style",
]);

export const CODED_REF_TYPES = new Set([
  "color",
  "size",
  "dimension",
  "graphicsVariant",
  "category",
  "subcategory",
]);

const REF_RANGE_MAP: Record<RefAddType, { value: string; code?: string }> = {
  color: { value: "colorsList", code: "colorsCode" },
  size: { value: "sizesList", code: "sizesCode" },
  dimension: { value: "dimensionsList", code: "dimensionsCode" },
  graphicsVariant: {
    value: "graphicsVariantList",
    code: "graphicsVariantCode",
  },
  graphic: { value: "graphicsList" },
  style: { value: "styleModList" },
};

function parseA1(rangeStr: string): {
  sheet: string;
  col: string;
  startRow: number;
} {
  const m = rangeStr.match(/^(.+)!([A-Z]+)(\d+)/);
  if (!m) throw new Error(`Cannot parse range: ${rangeStr}`);
  return { sheet: m[1], col: m[2], startRow: parseInt(m[3], 10) };
}

export async function appendRefEntry(
  sheets: SheetsClient,
  spreadsheetId: string,
  type: RefAddType,
  value: string,
  code?: string,
): Promise<{ value: string; code: string }> {
  const config = REF_RANGE_MAP[type];
  const isCodedType = Boolean(config.code);

  if (isCodedType && !code)
    throw new Error("Code is required for this ref type");

  const rangesToRead = [config.value, ...(config.code ? [config.code] : [])];
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: rangesToRead,
  });

  const vrs = response.data.valueRanges ?? [];
  const existingValues = (vrs[0]?.values ?? [])
    .flat()
    .map(String)
    .filter(Boolean);
  const existingCodes = config.code
    ? (vrs[1]?.values ?? [])
        .flat()
        .map(String)
        .filter(Boolean)
        .map((c) => c.toUpperCase())
    : [];

  if (existingValues.some((v) => v.toLowerCase() === value.toLowerCase())) {
    throw new Error(`"${value}" already exists`);
  }
  const normalizedCode = code?.toUpperCase() ?? "";
  if (isCodedType && existingCodes.includes(normalizedCode)) {
    throw new Error(`Code "${normalizedCode}" is already in use`);
  }

  const valueRangeMeta = parseA1(vrs[0]?.range ?? "");
  const nextRow = valueRangeMeta.startRow + existingValues.length;

  const data: { range: string; values: string[][] }[] = [
    {
      range: `'${valueRangeMeta.sheet}'!${valueRangeMeta.col}${nextRow}`,
      values: [[value]],
    },
  ];

  if (config.code && normalizedCode) {
    const codeRangeMeta = parseA1(vrs[1]?.range ?? "");
    data.push({
      range: `'${codeRangeMeta.sheet}'!${codeRangeMeta.col}${nextRow}`,
      values: [[normalizedCode]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });

  return { value, code: normalizedCode };
}

/**
 * Ensures a dimension entry exists in the dimensions tab.
 * If value or code already exists, does nothing. Otherwise appends a new row.
 * value format: `3"x5"` — code format: `3X5`
 */
export async function ensureDimensionExists(
  sheets: SheetsClient,
  spreadsheetId: string,
  value: string,
  code: string,
): Promise<void> {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["dimensionsList", "dimensionsCode"],
  });

  const vrs = response.data.valueRanges ?? [];
  const existingValues = (vrs[0]?.values ?? [])
    .flat()
    .map(String)
    .filter(Boolean);
  const existingCodes = (vrs[1]?.values ?? [])
    .flat()
    .map(String)
    .filter(Boolean);

  const codeUpper = code.toUpperCase();

  if (
    existingValues.some((v) => v.toLowerCase() === value.toLowerCase()) ||
    existingCodes.some((c) => c.toUpperCase() === codeUpper)
  ) {
    return;
  }

  const vr0 = vrs[0];
  const vr1 = vrs[1];
  if (!vr0?.range || !vr1?.range) return;

  const valueMeta = parseA1(vr0.range);
  const codeMeta = parseA1(vr1.range);
  const nextRow = valueMeta.startRow + existingValues.length;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        {
          range: `'${valueMeta.sheet}'!${valueMeta.col}${nextRow}`,
          values: [[value]],
        },
        {
          range: `'${codeMeta.sheet}'!${codeMeta.col}${nextRow}`,
          values: [[codeUpper]],
        },
      ],
    },
  });
}

export async function createWooCategory(
  name: string,
  parentWooId: number | null,
  display: "default" | "subcategories",
): Promise<number> {
  const woo = getWooConfig();
  const url = buildWooUrl(woo, "products/categories");
  // slug: lowercase, hyphens only — Woo auto-generates from name but we set it explicitly
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const body: Record<string, unknown> = { name, slug, display };
  if (parentWooId != null) body.parent = parentWooId;

  const targetUrl = url.split("?")[0];

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });

  const responseText = await res.text();
  console.log(
    `[createWooCategory] HTTP ${res.status}:`,
    responseText.slice(0, 30),
  );

  if (!res.ok) {
    throw new Error(
      `Woo category create failed (HTTP ${res.status}): ${responseText}`,
    );
  }

  let data: { id?: number };
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Woo category response not valid JSON: ${responseText}`);
  }

  if (!data.id)
    throw new Error(`Woo category response missing id: ${responseText}`);

  // Verify the category actually persisted — some staging setups silently drop it
  const getUrl = buildWooUrl(woo, "products/categories", { slug });
  const getRes = await fetch(getUrl, {
    headers: { Accept: "application/json" },
  });
  if (getRes.ok) {
    const list = (await getRes.json()) as Array<{ id: number }>;
    if (list.length > 0) {
      const verifiedId = list[0].id;
      console.log(
        `[createWooCategory] verified: POST id=${data.id}, GET by slug="${slug}" id=${verifiedId}`,
      );
      return verifiedId;
    }
    // POST returned 201 but GET finds nothing — category was not persisted
    throw new Error(
      `Woo created category (id=${data.id}, slug="${slug}") but it cannot be found via GET. ` +
        `A plugin or hook may be deleting it immediately after creation.`,
    );
  }

  return data.id;
}

/**
 * Resolves a category's Woo term ID by its code, creating the category in
 * Woo and writing the ID back into its existing sheet row if it's missing.
 * Used so a subcategory can be created even when its parent category was
 * never synced to Woo (e.g. after a staging recopy invalidated the old ID).
 */
export async function ensureCategoryWooId(
  sheets: SheetsClient,
  spreadsheetId: string,
  categoryCode: string,
): Promise<number> {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ["catList", "catCode", "catId"],
  });

  const vrs = response.data.valueRanges ?? [];
  const catList = (vrs[0]?.values ?? []).flat().map(String);
  const catCode = (vrs[1]?.values ?? []).flat().map(String);
  const catId = (vrs[2]?.values ?? []).flat().map(String);

  const codeUpper = categoryCode.toUpperCase();
  const i = catCode.findIndex((c) => c.toUpperCase() === codeUpper);
  if (i === -1) throw new Error(`Category code "${categoryCode}" not found`);

  if (catId[i]) return Number(catId[i]);

  const wooId = await createWooCategory(catList[i], null, "default");

  const catIdMeta = parseA1(vrs[2]?.range ?? "");
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${catIdMeta.sheet}'!${catIdMeta.col}${catIdMeta.startRow + i}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[String(wooId)]] },
  });

  return wooId;
}

export async function appendCategoryEntry(
  sheets: SheetsClient,
  spreadsheetId: string,
  type: "category" | "subcategory",
  value: string,
  code: string,
  wooId: number,
  label?: string,
  parentCode?: string,
): Promise<void> {
  const valueRange = type === "category" ? "catList" : "subCatList";
  const codeRange = type === "category" ? "catCode" : "subCatCode";
  const wooIdRange = type === "category" ? "catId" : "subCatId";
  const labelRange = type === "subcategory" ? "subCatLabel" : null;
  const parentCodeRange = type === "subcategory" ? "subCatParentCode" : null;

  const rangesToRead = [
    valueRange,
    codeRange,
    wooIdRange,
    ...(labelRange ? [labelRange] : []),
    ...(parentCodeRange ? [parentCodeRange] : []),
    // Only needed to resolve a subcategory conflict's parent category name
    // for the error message — cheap to include unconditionally.
    ...(type === "subcategory" ? ["catList", "catCode"] : []),
  ];

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: rangesToRead,
  });

  const vrs = response.data.valueRanges ?? [];
  // Raw (unfiltered) so its index lines up row-for-row with parentCodes below
  // — filtering blanks out of a copy first would desync the two arrays.
  const rawValues = (vrs[0]?.values ?? []).flat().map(String);
  const existingValues = rawValues.filter(Boolean);
  const existingCodes = (vrs[1]?.values ?? [])
    .flat()
    .map(String)
    .filter(Boolean)
    .map((c) => c.toUpperCase());

  const dupeRowIdx = rawValues.findIndex(
    (v) => v && v.toLowerCase() === value.toLowerCase(),
  );
  if (dupeRowIdx !== -1) {
    if (type === "subcategory" && parentCodeRange) {
      // Index positions: [value, code, wooId, label?, parentCode, catList, catCode]
      const parentCodes = (vrs[4]?.values ?? []).flat().map(String);
      const catValues = (vrs[5]?.values ?? []).flat().map(String);
      const catCodes = (vrs[6]?.values ?? []).flat().map(String);
      const conflictParentCode = parentCodes[dupeRowIdx]?.toUpperCase();
      const catIdx = conflictParentCode
        ? catCodes.findIndex((c) => c.toUpperCase() === conflictParentCode)
        : -1;
      const categoryName = catIdx !== -1 ? catValues[catIdx] : null;
      throw new Error(
        categoryName
          ? `"${value}" already exists under category "${categoryName}"`
          : `"${value}" already exists`,
      );
    }
    throw new Error(`"${value}" already exists`);
  }
  if (existingCodes.includes(code.toUpperCase())) {
    throw new Error(`Code "${code.toUpperCase()}" is already in use`);
  }

  const valueMeta = parseA1(vrs[0]?.range ?? "");
  const codeMeta = parseA1(vrs[1]?.range ?? "");
  const wooMeta = parseA1(vrs[2]?.range ?? "");
  const nextRow = valueMeta.startRow + existingValues.length;

  const data: { range: string; values: string[][] }[] = [
    {
      range: `'${valueMeta.sheet}'!${valueMeta.col}${nextRow}`,
      values: [[value]],
    },
    {
      range: `'${codeMeta.sheet}'!${codeMeta.col}${nextRow}`,
      values: [[code.toUpperCase()]],
    },
    {
      range: `'${wooMeta.sheet}'!${wooMeta.col}${nextRow}`,
      values: [[String(wooId)]],
    },
  ];

  if (labelRange && vrs[3]) {
    const labelMeta = parseA1(vrs[3]?.range ?? "");
    data.push({
      range: `'${labelMeta.sheet}'!${labelMeta.col}${nextRow}`,
      values: [[label || value]],
    });
  }

  if (parentCodeRange && vrs[4]) {
    const parentCodeMeta = parseA1(vrs[4]?.range ?? "");
    data.push({
      range: `'${parentCodeMeta.sheet}'!${parentCodeMeta.col}${nextRow}`,
      values: [[(parentCode ?? "").toUpperCase()]],
    });
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

// Convert 0-based column index to A1 column letter (A, B, ..., Z, AA, AB, ...)
export function colLetter(idx: number): string {
  let s = "";
  let n = idx;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export async function createProductRow(
  sheets: SheetsClient,
  spreadsheetId: string,
  fields: NewProductFields,
): Promise<{ sheetRow: number; rowId: string }> {
  const productData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });

  const values = productData.data.values ?? [];
  if (!values.length) throw new Error("products sheet returned no data");

  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const col = (name: string) => colByHeader(headers, name);

  // products_values includes the header row; sheet row 1 = header, next empty = values.length + 1
  const sheetRow = values.length + 1;
  const rowId = crypto.randomUUID();

  // product_id used to be a live ARRAYFORMULA (COUNTIFS by row position) —
  // any deletion above a row silently renumbered every product_id below it,
  // while variant rows keep whatever product_id they were created with
  // forever. GAS creates its own rows independently and assigns its own
  // product_id, so this column no longer needs to be formula-driven for our
  // side — assigning it once here, as a plain value, means an existing
  // row's product_id can never change again regardless of what gets deleted
  // around it later. Requires the ARRAYFORMULA to be cleared from this
  // column in the sheet first, or Sheets will reject writes into its spill
  // range.
  const refData = await readRefData(sheets, spreadsheetId);
  const categoryEntry = refData.categories.find(
    (c) => c.value === fields.category,
  );
  if (!categoryEntry?.code) {
    throw new Error(`No category code found for category "${fields.category}"`);
  }
  const prefix = `${categoryEntry.code}-`;

  // Next id is read straight from what currently exists — the highest
  // numeric suffix among this category's live product_ids, +1. A separate
  // persistent counter (catLastProductNum) was tried instead so a deleted
  // product's number could never be reused, but it silently drifted out of
  // sync with reality (nothing kept it honest) and became more confusing
  // than the id-reuse tradeoff it was meant to avoid. Reusing a deleted
  // product's number is accepted as fine — the sheet is the source of
  // truth, and if that number isn't attached to a live row anymore, nothing
  // meaningfully still depends on it.
  const productIdCol = col("product_id");
  let maxNum = 0;
  for (let i = 1; i < values.length; i++) {
    const pid = String((values[i] as string[])[productIdCol] ?? "").trim();
    if (!pid.startsWith(prefix)) continue;
    const n = Number(pid.slice(prefix.length));
    if (Number.isFinite(n) && n > maxNum) maxNum = n;
  }
  const nextNum = maxNum + 1;
  const newProductId = `${prefix}${String(nextNum).padStart(4, "0")}`;

  // Write only the user-provided cells — never touch other formula/protected columns
  const cell = (name: string, value: string) => ({
    range: `products!${colLetter(col(name))}${sheetRow}`,
    values: [[value]],
  });

  const writes = [
    cell("product_id", newProductId),
    cell("category", fields.category),
    cell("subcategory", fields.subcategory),
    cell("base_price_dollars", fields.basePriceDollars),
    cell("weight_oz", fields.weightOz),
    cell("row_id", rowId),
    ...(fields.displayName ? [cell("display_name", fields.displayName)] : []),
    ...(fields.design ? [cell("design", fields.design)] : []),
    ...(fields.styleModifier
      ? [cell("style_modifier", fields.styleModifier)]
      : []),
    ...(fields.dimensionsWidth
      ? [cell("dimensions_width", fields.dimensionsWidth)]
      : []),
    ...(fields.dimensionsHeight
      ? [cell("dimensions_height", fields.dimensionsHeight)]
      : []),
    ...(fields.dimensionsDepth
      ? [cell("dimensions_depth", fields.dimensionsDepth)]
      : []),
    ...(fields.salePriceDollars
      ? [cell("sale_price_dollars", fields.salePriceDollars)]
      : []),
    ...(fields.publishedStatus
      ? [cell("published_status", fields.publishedStatus)]
      : [cell("published_status", "draft")]),
  ];

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: writes,
    },
  });

  return { sheetRow, rowId };
}

// Rolls back a create_product request that wrote the row (createProductRow
// above) but failed on one of the steps after it — most commonly
// pollForProductSku timing out because the sheet's sku formula never
// resolved, or updateDescriptionFields failing on a network hiccup.
//
// Looks the row up by row_id, NOT by the sheet position it had at creation
// time — a captured row number can go stale the instant another request
// inserts or deletes a row anywhere above it before this rollback runs,
// and deleting by a stale position risks removing a completely different
// (possibly live) product. This is the exact bug class `product_id` itself
// used to have as a live ARRAYFORMULA (see that field's own comment above);
// row_id is a UUID we generate ourselves at creation time specifically
// because it's stable regardless of position, so rollback re-reads the
// sheet fresh and finds the row by that UUID right before deleting it.
//
// If a sku HAD become known before the failure, also cleans up any
// descriptions/inventory_index rows already written for it, so no partial
// row of any kind is left for the next create attempt to collide with or
// for a human to find later and wonder about. Safe to call this without
// ever having touched Woo — create_product doesn't call Woo at all
// (sync-to-site is a separate, deliberate step), so there's nothing on
// that side to undo.
export async function rollbackPartialProductCreate(
  sheets: SheetsClient,
  spreadsheetId: string,
  rowId: string,
  sku?: string,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheetIdByName = new Map(
    (meta.data.sheets ?? []).map((s) => [
      s.properties?.title ?? "",
      s.properties?.sheetId ?? 0,
    ]),
  );

  const productsRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });
  const productValues = productsRes.data.values ?? [];
  const productHeaders = ((productValues[0] as string[]) ?? []).map((h) =>
    String(h).trim(),
  );
  const rowIdCol = colByHeader(productHeaders, "row_id");
  const rowIdx = productValues.findIndex(
    (row, i) =>
      i > 0 && String((row as string[])[rowIdCol] ?? "").trim() === rowId,
  );
  if (rowIdx === -1) {
    // Already gone — nothing left to roll back.
    return;
  }

  const targets: Array<{ sheetName: string; indices: number[] }> = [
    { sheetName: "products", indices: [rowIdx] },
  ];

  if (sku) {
    const [descRes, invRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "descriptions" }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "inventory_index",
      }),
    ]);
    const skus = new Set([sku]);
    targets.push(
      {
        sheetName: "descriptions",
        indices: findRowIndicesBySku(descRes.data.values ?? [], skus),
      },
      {
        sheetName: "inventory_index",
        indices: findRowIndicesBySku(invRes.data.values ?? [], skus),
      },
    );
  }

  await deleteSheetRows(sheets, spreadsheetId, sheetIdByName, targets);
}

export interface UpdateProductFields {
  displayName?: string;
  basePriceDollars?: string;
  salePriceDollars?: string;
  publishedStatus?: string;
  weightOz?: string;
  primaryDescription?: string;
  shortDescription?: string;
  dimensionsWidth?: string;
  dimensionsHeight?: string;
  dimensionsDepth?: string;
}

export async function getProductWooId(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
): Promise<number | null> {
  const productData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });
  const values = productData.data.values ?? [];
  if (!values.length) throw new Error("products sheet returned no data");

  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const skuIdx = colByHeader(headers, "sku");
  const wooIdIdx = colByHeader(headers, "woo_id");

  for (let i = 1; i < values.length; i++) {
    const row = values[i] as string[];
    if (String(row[skuIdx] ?? "").trim() === sku) {
      const raw = String(row[wooIdIdx] ?? "").trim();
      return raw ? Number(raw) : null;
    }
  }
  throw new Error(`Product SKU "${sku}" not found`);
}

export async function updateProduct(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
  fields: UpdateProductFields,
): Promise<void> {
  const productData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });

  const values = productData.data.values ?? [];
  if (!values.length) throw new Error("products sheet returned no data");

  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const col = (name: string) => colByHeader(headers, name);
  const skuIdx = col("sku");

  let rowIdx = -1;
  for (let i = 1; i < values.length; i++) {
    if (String((values[i] as string[])[skuIdx] ?? "").trim() === sku) {
      rowIdx = i;
      break;
    }
  }
  if (rowIdx === -1) throw new Error(`Product SKU "${sku}" not found`);

  const row = values[rowIdx] as string[];
  const effectiveBasePrice =
    fields.basePriceDollars ?? String(row[col("base_price_dollars")] ?? "");
  const effectiveSalePrice =
    fields.salePriceDollars ?? String(row[col("sale_price_dollars")] ?? "");
  if (
    (fields.basePriceDollars !== undefined ||
      fields.salePriceDollars !== undefined) &&
    !isSalePriceValid(effectiveBasePrice, effectiveSalePrice)
  ) {
    throw new Error("Sale price must be less than base price");
  }

  const sheetRow = rowIdx + 1;
  const cell = (name: string, value: string) => ({
    range: `products!${colLetter(col(name))}${sheetRow}`,
    values: [[value]],
  });

  const writes = [
    ...(fields.displayName !== undefined
      ? [cell("display_name", fields.displayName)]
      : []),
    ...(fields.basePriceDollars !== undefined
      ? [cell("base_price_dollars", fields.basePriceDollars)]
      : []),
    ...(fields.salePriceDollars !== undefined
      ? [cell("sale_price_dollars", fields.salePriceDollars)]
      : []),
    ...(fields.publishedStatus !== undefined
      ? [cell("published_status", fields.publishedStatus)]
      : []),
    ...(fields.weightOz !== undefined
      ? [cell("weight_oz", fields.weightOz)]
      : []),
    ...(fields.dimensionsWidth !== undefined
      ? [cell("dimensions_width", fields.dimensionsWidth)]
      : []),
    ...(fields.dimensionsHeight !== undefined
      ? [cell("dimensions_height", fields.dimensionsHeight)]
      : []),
    ...(fields.dimensionsDepth !== undefined
      ? [cell("dimensions_depth", fields.dimensionsDepth)]
      : []),
  ];

  const descFields = {
    ...(fields.primaryDescription !== undefined
      ? { primaryDescription: fields.primaryDescription }
      : {}),
    ...(fields.shortDescription !== undefined
      ? { shortDescription: fields.shortDescription }
      : {}),
  };

  const hasProductWrites = writes.length > 0;
  const hasDescWrites = Object.keys(descFields).length > 0;

  if (!hasProductWrites && !hasDescWrites) return;

  await Promise.all([
    hasProductWrites
      ? sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "USER_ENTERED", data: writes },
        })
      : Promise.resolve(),
    hasDescWrites
      ? updateDescriptionFields(sheets, spreadsheetId, sku, descFields)
      : Promise.resolve(),
  ]);
}

export interface UpdateVariantFields {
  priceVariant?: string;
  salePriceVariant?: string;
  weightOzVariant?: string;
  descriptionVariant?: string;
}

export interface ParsedCreateVariants {
  productId: string;
  colors: string[];
  sizes: string[];
  dimensions: string[];
  shared: VariantComboShared;
}

export function parseUpdateProductFields(
  body: Partial<UpdateProductFields>,
): UpdateProductFields {
  const fields: UpdateProductFields = {};
  if (typeof body.displayName === "string")
    fields.displayName = body.displayName.trim();
  if (typeof body.basePriceDollars === "string")
    fields.basePriceDollars = body.basePriceDollars.trim();
  if (typeof body.salePriceDollars === "string")
    fields.salePriceDollars = body.salePriceDollars.trim();
  if (
    typeof body.publishedStatus === "string" &&
    ["draft", "publish"].includes(body.publishedStatus)
  )
    fields.publishedStatus = body.publishedStatus;
  if (typeof body.weightOz === "string") fields.weightOz = body.weightOz.trim();
  if (typeof body.primaryDescription === "string")
    fields.primaryDescription = body.primaryDescription.trim();
  if (typeof body.shortDescription === "string")
    fields.shortDescription = body.shortDescription.trim();
  if (typeof body.dimensionsWidth === "string")
    fields.dimensionsWidth = body.dimensionsWidth.trim();
  if (typeof body.dimensionsHeight === "string")
    fields.dimensionsHeight = body.dimensionsHeight.trim();
  if (typeof body.dimensionsDepth === "string")
    fields.dimensionsDepth = body.dimensionsDepth.trim();
  return fields;
}

export function parseUpdateVariantFields(
  body: Record<string, unknown>,
): UpdateVariantFields {
  const fields: UpdateVariantFields = {};
  if (body.priceVariant !== undefined)
    fields.priceVariant = String(body.priceVariant).trim();
  if (body.salePriceVariant !== undefined)
    fields.salePriceVariant = String(body.salePriceVariant).trim();
  if (body.weightOzVariant !== undefined)
    fields.weightOzVariant = String(body.weightOzVariant).trim();
  if (body.descriptionVariant !== undefined)
    fields.descriptionVariant = String(body.descriptionVariant).trim();
  return fields;
}

export function parseNewProductFields(
  raw: unknown,
): NewProductFields | { error: string } {
  const body = raw as Partial<NewProductFields>;
  const { category, subcategory, basePriceDollars, weightOz } = body;
  if (!category || !subcategory || !basePriceDollars || !weightOz) {
    return {
      error:
        "Missing required fields: category, subcategory, basePriceDollars, weightOz",
    };
  }
  if (!isSalePriceValid(basePriceDollars, body.salePriceDollars)) {
    return { error: "Sale price must be less than base price" };
  }
  return {
    category,
    subcategory,
    basePriceDollars,
    weightOz,
    displayName: body.displayName,
    design: body.design,
    styleModifier: body.styleModifier,
    dimensionsWidth: body.dimensionsWidth,
    dimensionsHeight: body.dimensionsHeight,
    dimensionsDepth: body.dimensionsDepth,
    primaryDescription: body.primaryDescription,
    shortDescription: body.shortDescription,
    salePriceDollars: body.salePriceDollars,
    publishedStatus:
      body.publishedStatus &&
      ["draft", "publish"].includes(body.publishedStatus)
        ? body.publishedStatus
        : "draft",
  };
}

export function parseCreateVariantsBody(
  raw: unknown,
): ParsedCreateVariants | { error: string } {
  const body = raw as {
    productId?: string;
    colors?: unknown;
    sizes?: unknown;
    dimensions?: unknown;
    design?: string;
    designVariant?: string;
    priceVariant?: string;
    weightOzVariant?: string;
    descriptionVariant?: string;
    stockQty?: number;
  };
  const productId = body.productId?.trim();
  if (!productId) return { error: "Missing productId" };
  const colors = Array.isArray(body.colors) ? body.colors.filter(Boolean) : [];
  const sizes = Array.isArray(body.sizes) ? body.sizes.filter(Boolean) : [];
  const dimensions = Array.isArray(body.dimensions)
    ? body.dimensions.filter(Boolean)
    : [];
  if (!colors.length && !sizes.length && !dimensions.length) {
    return { error: "Must provide at least one color, size, or dimension" };
  }
  const shared: VariantComboShared = {
    design: body.design || undefined,
    designVariant: body.designVariant || undefined,
    priceVariant: body.priceVariant || undefined,
    weightOzVariant: body.weightOzVariant || undefined,
    descriptionVariant: body.descriptionVariant || undefined,
    stockQty: body.stockQty !== undefined ? Number(body.stockQty) : undefined,
  };
  return { productId, colors, sizes, dimensions, shared };
}

export async function updateVariant(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
  fields: UpdateVariantFields,
): Promise<void> {
  const variantData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "variants_values",
  });

  const values = variantData.data.values ?? [];
  if (!values.length) throw new Error("variants sheet returned no data");

  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const col = (name: string) => colByHeader(headers, name);
  const skuIdx = col("sku");

  let rowIdx = -1;
  for (let i = 1; i < values.length; i++) {
    if (String((values[i] as string[])[skuIdx] ?? "").trim() === sku) {
      rowIdx = i;
      break;
    }
  }
  if (rowIdx === -1) throw new Error(`Variant SKU "${sku}" not found`);

  const row = values[rowIdx] as string[];
  // Effective regular price is the variant's own override if one is set,
  // else it falls back to the parent product's base price — which isn't
  // loaded here, so we only validate when a variant-level override price is
  // actually in play. If there's no override, Woo's own sale_price >=
  // regular_price rejection at sync time is the backstop instead.
  const effectiveRegularPrice =
    fields.priceVariant ?? String(row[col("price_variant")] ?? "");
  const effectiveSalePrice =
    fields.salePriceVariant ?? String(row[col("sale_price_variant")] ?? "");
  if (
    (fields.priceVariant !== undefined ||
      fields.salePriceVariant !== undefined) &&
    effectiveRegularPrice &&
    !isSalePriceValid(effectiveRegularPrice, effectiveSalePrice)
  ) {
    throw new Error("Sale price must be less than the regular price");
  }

  const sheetRow = rowIdx + 1;
  const cell = (name: string, value: string) => ({
    range: `variants!${colLetter(col(name))}${sheetRow}`,
    values: [[value]],
  });

  const writes = [
    ...(fields.priceVariant !== undefined
      ? [cell("price_variant", fields.priceVariant)]
      : []),
    ...(fields.salePriceVariant !== undefined
      ? [cell("sale_price_variant", fields.salePriceVariant)]
      : []),
    ...(fields.weightOzVariant !== undefined
      ? [cell("weight_oz_variant", fields.weightOzVariant)]
      : []),
  ];

  const hasVariantWrites = writes.length > 0;
  const hasDescWrite = fields.descriptionVariant !== undefined;

  if (!hasVariantWrites && !hasDescWrite) return;

  await Promise.all([
    hasVariantWrites
      ? sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: "USER_ENTERED", data: writes },
        })
      : Promise.resolve(),
    hasDescWrite
      ? updateDescriptionFields(sheets, spreadsheetId, sku, {
          descriptionVariant: fields.descriptionVariant,
        })
      : Promise.resolve(),
  ]);
}

export async function updateDescriptionFields(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
  fields: {
    primaryDescription?: string;
    shortDescription?: string;
    descriptionVariant?: string;
  },
): Promise<void> {
  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "descriptions",
  });

  const values = (sheetRes.data.values ?? []) as string[][];
  const headers = (values[0] ?? []).map((h) => String(h).trim());
  const skuIdx = headers.indexOf("sku");
  if (skuIdx === -1) throw new Error('descriptions sheet missing "sku" column');

  const colName: Record<string, string> = {
    primaryDescription: "primary_description",
    shortDescription: "short_description",
    descriptionVariant: "description_variant",
  };

  let rowIdx = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i]?.[skuIdx] ?? "").trim() === sku) {
      rowIdx = i;
      break;
    }
  }

  if (rowIdx === -1) {
    // Row doesn't exist — append with all provided fields
    const newRow = new Array(headers.length).fill("");
    newRow[skuIdx] = sku;
    for (const [key, col] of Object.entries(colName)) {
      const value = fields[key as keyof typeof fields];
      if (value === undefined) continue;
      const idx = headers.indexOf(col);
      if (idx >= 0) newRow[idx] = value;
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "descriptions",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [newRow] },
    });
    return;
  }

  // Row exists — write only the provided fields
  const sheetRow = rowIdx + 1;
  const writes: Array<{ range: string; values: string[][] }> = [];
  for (const [key, col] of Object.entries(colName)) {
    const value = fields[key as keyof typeof fields];
    if (value === undefined) continue;
    const idx = headers.indexOf(col);
    if (idx >= 0) {
      writes.push({
        range: `descriptions!${colLetter(idx)}${sheetRow}`,
        values: [[value]],
      });
    }
  }

  if (!writes.length) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: writes,
    },
  });
}

// Self-heal safety net: ensures every known catalog SKU has a row in
// descriptions, blank if missing. Catches SKUs that never got a row written
// — e.g. a create_product request that wrote its product row but died
// before reaching updateDescriptionFields. Cheap to call on every catalog
// load: one read, one batched append only for what's actually missing.
export async function ensureDescriptionRowsExist(
  sheets: SheetsClient,
  spreadsheetId: string,
  skus: string[],
): Promise<{ appended: number }> {
  const wanted = [...new Set(skus.map((s) => s.trim()).filter(Boolean))];
  if (!wanted.length) return { appended: 0 };

  const sheetRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "descriptions",
  });
  const values = (sheetRes.data.values ?? []) as string[][];
  const headers = (values[0] ?? []).map((h) => String(h).trim());
  const skuIdx = headers.indexOf("sku");
  if (skuIdx === -1) throw new Error('descriptions sheet missing "sku" column');

  const existing = new Set<string>();
  for (let i = 1; i < values.length; i++) {
    const sku = String(values[i]?.[skuIdx] ?? "").trim();
    if (sku) existing.add(sku);
  }

  const missing = wanted.filter((sku) => !existing.has(sku));
  if (!missing.length) return { appended: 0 };

  const rows = missing.map((sku) => {
    const row = new Array(headers.length).fill("");
    row[skuIdx] = sku;
    return row;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "descriptions",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });

  return { appended: missing.length };
}

export async function pollForProductSku(
  sheets: SheetsClient,
  spreadsheetId: string,
  sheetRow: number,
  timeoutMs = 60_000,
): Promise<{ productId: string; sku: string }> {
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products!1:1",
  });
  const headers = ((headerResponse.data.values?.[0] ?? []) as string[]).map(
    (h) => String(h).trim(),
  );
  const skuIdx = colByHeader(headers, "sku");
  const productIdIdx = colByHeader(headers, "product_id");

  const deadline = Date.now() + timeoutMs;
  let delay = 800;

  while (Date.now() < deadline) {
    const rowResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `products!A${sheetRow}:Z${sheetRow}`,
    });

    const row = (rowResponse.data.values?.[0] ?? []) as string[];
    const sku = (row[skuIdx] ?? "").trim();
    const productId = (row[productIdIdx] ?? "").trim();

    if (sku) return { productId, sku };

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.floor(delay * 1.5), 4000);
  }

  throw new Error(
    `Timeout waiting for sku formula at products row ${sheetRow} — formula chain may still be computing`,
  );
}

// Deterministic JSON stringify (sorts object keys recursively) — matches GAS stableStringify
function stableStringify(val: unknown): string {
  if (val === null || val === undefined) return String(val);
  if (typeof val !== "object") return JSON.stringify(val);
  if (Array.isArray(val)) return "[" + val.map(stableStringify).join(",") + "]";
  const keys = Object.keys(val as object).sort();
  return (
    "{" +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ":" +
          stableStringify((val as Record<string, unknown>)[k]),
      )
      .join(",") +
    "}"
  );
}

// Fingerprint of full current product state (content + stock), used to skip
// re-pushing a product to Woo when nothing has changed since last_hash was
// written. Any successful Woo write (content sync or stock sync) recomputes
// and re-stores this, so it always reflects the latest known-synced state.
export function computeProductSyncHash(group: CatalogGroup): string {
  const uniqueColors = [
    ...new Set(group.rows.map((r) => r.color).filter(Boolean)),
  ].sort() as string[];
  const uniqueSizes = [
    ...new Set(group.rows.map((r) => r.size).filter(Boolean)),
  ].sort() as string[];

  const core = {
    skuRoot: group.sku,
    name: group.displayName || "",
    description: group.primaryDescription || "",
    short_description: group.shortDescription || "",
    status: group.publishedStatus || "",
    category: group.categoryCode || group.category || "",
    subcategory: group.subcategoryCode || group.subcategory || "",
    regular_price: group.basePriceDollars || "",
    sale_price: group.salePriceDollars || "",
    stock_qty: group.rows.length === 0 ? (group.stockQty ?? 0) : null,
    shipping: {
      weight: group.weightOz || "",
      width: group.dimensionsWidth || "",
      height: group.dimensionsHeight || "",
      depth: group.dimensionsDepth || "",
    },
    attributes: [
      ...(uniqueColors.length
        ? [{ name: "Color", options: uniqueColors, variation: true }]
        : []),
      ...(uniqueSizes.length
        ? [{ name: "Size", options: uniqueSizes, variation: true }]
        : []),
    ],
    variations: group.rows
      .map((v) => ({
        attributes: [
          ...(v.color ? [{ name: "Color", option: v.color }] : []),
          ...(v.size ? [{ name: "Size", option: v.size }] : []),
        ],
        description: v.descriptionVariant || "",
        regular_price: v.priceVariant || group.basePriceDollars || "",
        sale_price: v.salePriceVariant || group.salePriceDollars || "",
        sku: v.sku,
        stock_qty: v.stockQty ?? 0,
        weight: v.weightOzVariant || v.baseWeightOz || "",
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  };

  return createHash("sha256").update(stableStringify(core)).digest("hex");
}

// Writes last_hash + last_synced_at for a known sheet row (use when row is already in hand)
export async function writeProductSyncHash(
  sheets: SheetsClient,
  spreadsheetId: string,
  sheetRow: number,
  hash: string,
): Promise<void> {
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products!1:1",
  });
  const headers = ((headerResponse.data.values?.[0] ?? []) as string[]).map(
    (h) => String(h).trim(),
  );
  const col = (name: string) => colByHeader(headers, name);
  const now = new Date().toISOString();

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        {
          range: `products!${colLetter(col("last_hash"))}${sheetRow}`,
          values: [[hash]],
        },
        {
          range: `products!${colLetter(col("last_synced_at"))}${sheetRow}`,
          values: [[now]],
        },
      ],
    },
  });
}

// Batch version — resolves sheet rows by sku, used when row numbers aren't known up front
export async function writeProductSyncHashes(
  sheets: SheetsClient,
  spreadsheetId: string,
  entries: Array<{ sku: string; hash: string }>,
): Promise<void> {
  if (!entries.length) return;

  const productData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });

  const values = productData.data.values ?? [];
  if (values.length < 2) return;

  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const col = (name: string) => colByHeader(headers, name);
  const skuIdx = col("sku");
  const hashIdx = col("last_hash");
  const syncedAtIdx = col("last_synced_at");

  const rowBySku = new Map<string, number>();
  for (let i = 1; i < values.length; i++) {
    const sku = String((values[i] as string[])[skuIdx] ?? "").trim();
    if (sku) rowBySku.set(sku, i + 1);
  }

  const now = new Date().toISOString();
  const data: Array<{ range: string; values: string[][] }> = [];

  for (const { sku, hash } of entries) {
    const sheetRow = rowBySku.get(sku);
    if (!sheetRow) {
      console.warn(
        `writeProductSyncHashes: no writable row for SKU ${sku} — in protected row 2 or not found; hash not saved`,
      );
      continue;
    }
    data.push(
      { range: `products!${colLetter(hashIdx)}${sheetRow}`, values: [[hash]] },
      {
        range: `products!${colLetter(syncedAtIdx)}${sheetRow}`,
        values: [[now]],
      },
    );
  }

  if (!data.length) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

export async function writeProductWooId(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
  wooId: number,
): Promise<void> {
  const productData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });
  const values = productData.data.values ?? [];
  if (values.length < 2) throw new Error("products sheet is empty");

  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const skuIdx = colByHeader(headers, "sku");
  const wooIdIdx = colByHeader(headers, "woo_id");

  let sheetRow: number | null = null;
  for (let i = 1; i < values.length; i++) {
    if (String((values[i] as string[])[skuIdx] ?? "").trim() === sku) {
      sheetRow = i + 1;
      break;
    }
  }
  if (!sheetRow) throw new Error(`SKU "${sku}" not found in products sheet`);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `products!${colLetter(wooIdIdx)}${sheetRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[String(wooId)]] },
  });
}


// Returns 0-based row indices (matching the values array) where the sku column matches any of the given SKUs.
// Skips row 0 (headers). Used to build delete requests for descriptions and inventory_index.
function findRowIndicesBySku(values: string[][], skus: Set<string>): number[] {
  if (values.length < 2) return [];
  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const skuIdx = headers.indexOf("sku");
  if (skuIdx < 0) return [];
  const indices: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const rowSku = String((values[i] as string[])[skuIdx] ?? "").trim();
    if (skus.has(rowSku)) indices.push(i);
  }
  return indices;
}

// Executes row deletions across one or more sheets in a single batchUpdate.
// Rows within each sheet are deleted highest-index-first to avoid index shifting.
async function deleteSheetRows(
  sheets: SheetsClient,
  spreadsheetId: string,
  sheetIdByName: Map<string, number>,
  targets: Array<{ sheetName: string; indices: number[] }>,
): Promise<void> {
  const requests: sheets_v4.Schema$Request[] = [];

  for (const { sheetName, indices } of targets) {
    const sheetId = sheetIdByName.get(sheetName);
    if (sheetId === undefined)
      throw new Error(`Sheet "${sheetName}" not found`);
    const sorted = [...indices].sort((a, b) => b - a);
    for (const idx of sorted) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: idx,
            endIndex: idx + 1,
          },
        },
      });
    }
  }

  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests },
    });
  }
}

export async function deleteProduct(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
): Promise<{
  variantsDeleted: number;
  descriptionsDeleted: number;
  inventoryIndexDeleted: number;
  wooId: number | null;
}> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheetIdByName = new Map(
    (meta.data.sheets ?? []).map((s) => [
      s.properties?.title ?? "",
      s.properties?.sheetId ?? 0,
    ]),
  );

  const [productsRes, variantsRes, descRes, invRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "products_values" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "variants_values" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "descriptions" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "inventory_index" }),
  ]);

  // Locate the product row
  const productValues = productsRes.data.values ?? [];
  if (!productValues.length) throw new Error("products sheet is empty");
  const productHeaders = (productValues[0] as string[]).map((h) =>
    String(h).trim(),
  );
  const pSkuIdx = colByHeader(productHeaders, "sku");
  const pProductIdIdx = colByHeader(productHeaders, "product_id");
  const pWooIdIdx = colByHeader(productHeaders, "woo_id");

  let productRowIdx = -1;
  let productId = "";
  let wooId: number | null = null;
  for (let i = 1; i < productValues.length; i++) {
    if (String((productValues[i] as string[])[pSkuIdx] ?? "").trim() === sku) {
      productRowIdx = i;
      productId = String(
        (productValues[i] as string[])[pProductIdIdx] ?? "",
      ).trim();
      const rawWooId = String(
        (productValues[i] as string[])[pWooIdIdx] ?? "",
      ).trim();
      wooId = rawWooId ? Number(rawWooId) : null;
      break;
    }
  }
  if (productRowIdx === -1) throw new Error(`Product SKU "${sku}" not found`);
  if (productRowIdx === 1)
    throw new Error(
      `Product SKU "${sku}" is in the protected row 2 and cannot be deleted through this tool`,
    );

  // Locate all variant rows for this product
  const variantValues = variantsRes.data.values ?? [];
  const variantHeaders = variantValues.length
    ? (variantValues[0] as string[]).map((h) => String(h).trim())
    : [];
  const variantRowIndices: number[] = [];
  const variantSkus: string[] = [];

  if (variantHeaders.length && productId) {
    const vProductIdIdx = colByHeader(variantHeaders, "product_id");
    const vSkuIdx = colByHeader(variantHeaders, "sku");
    for (let i = 1; i < variantValues.length; i++) {
      const row = variantValues[i] as string[];
      if (String(row[vProductIdIdx] ?? "").trim() === productId) {
        if (i === 1) continue; // row 2 of variants holds the ARRAYFORMULA anchor — never delete
        variantRowIndices.push(i);
        variantSkus.push(String(row[vSkuIdx] ?? "").trim());
      }
    }
  }

  const allSkus = new Set([sku, ...variantSkus].filter(Boolean));

  const descRowIndices = findRowIndicesBySku(
    descRes.data.values ?? [],
    allSkus,
  );
  const invRowIndices = findRowIndicesBySku(invRes.data.values ?? [], allSkus);

  await deleteSheetRows(sheets, spreadsheetId, sheetIdByName, [
    { sheetName: "products", indices: [productRowIdx] },
    { sheetName: "variants", indices: variantRowIndices },
    { sheetName: "descriptions", indices: descRowIndices },
    { sheetName: "inventory_index", indices: invRowIndices },
  ]);

  // Verify the product row is actually gone before reporting success — a
  // batchUpdate that appears to succeed but silently leaves a row behind is
  // far worse than a slow request: it reports ok:true while the sheet still
  // has the "deleted" product, and nothing downstream would ever notice.
  const verifyRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "products_values",
  });
  const stillPresent = (verifyRes.data.values ?? []).some(
    (row, i) => i > 0 && String((row as string[])[pSkuIdx] ?? "").trim() === sku,
  );
  if (stillPresent) {
    throw new Error(
      `Product SKU "${sku}" still exists in the products sheet after the delete request reported success — the row was not actually removed. Do not retry blindly; check the sheet directly before trying again.`,
    );
  }

  return {
    variantsDeleted: variantRowIndices.length,
    descriptionsDeleted: descRowIndices.length,
    inventoryIndexDeleted: invRowIndices.length,
    wooId,
  };
}

export async function deleteVariant(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
  dataIndex?: number,
): Promise<{
  descriptionsDeleted: number;
  inventoryIndexDeleted: number;
  wooVariantId: number | null;
  parentWooId: number | null;
  wasLastVariant: boolean;
  productId: string;
}> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheetIdByName = new Map(
    (meta.data.sheets ?? []).map((s) => [
      s.properties?.title ?? "",
      s.properties?.sheetId ?? 0,
    ]),
  );

  const [variantsRes, descRes, invRes, productsRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "variants_values" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "descriptions" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "inventory_index" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "products_values" }),
  ]);

  const variantValues = variantsRes.data.values ?? [];
  if (variantValues.length < 2) throw new Error("variants sheet is empty");
  const variantHeaders = (variantValues[0] as string[]).map((h) =>
    String(h).trim(),
  );
  const vSkuIdx = colByHeader(variantHeaders, "sku");
  const vWooVariantIdIdx = colByHeader(variantHeaders, "woo_variant_id");
  const vProductIdIdx = colByHeader(variantHeaders, "product_id");

  let variantRowIdx = -1;
  let wooVariantId: number | null = null;
  let variantProductId = "";
  for (let i = 1; i < variantValues.length; i++) {
    if (String((variantValues[i] as string[])[vSkuIdx] ?? "").trim() !== sku)
      continue;
    if (dataIndex !== undefined && i !== dataIndex) continue;
    variantRowIdx = i;
    const rawWooVariantId = String(
      (variantValues[i] as string[])[vWooVariantIdIdx] ?? "",
    ).trim();
    wooVariantId = rawWooVariantId ? Number(rawWooVariantId) : null;
    variantProductId = String(
      (variantValues[i] as string[])[vProductIdIdx] ?? "",
    ).trim();
    break;
  }
  if (variantRowIdx === -1)
    throw new Error(
      dataIndex !== undefined
        ? `Variant SKU "${sku}" at row ${dataIndex + 1} not found`
        : `Variant SKU "${sku}" not found`,
    );
  if (variantRowIdx === 1)
    throw new Error(
      `Variant SKU "${sku}" is in the protected row 2 and cannot be deleted through this tool`,
    );

  // Look up parent product's woo_id so the caller can delete the variation from Woo
  let parentWooId: number | null = null;
  if (variantProductId) {
    const productValues = productsRes.data.values ?? [];
    if (productValues.length > 1) {
      const productHeaders = (productValues[0] as string[]).map((h) =>
        String(h).trim(),
      );
      const pProductIdIdx = colByHeader(productHeaders, "product_id");
      const pWooIdIdx = colByHeader(productHeaders, "woo_id");
      for (let i = 1; i < productValues.length; i++) {
        if (
          String((productValues[i] as string[])[pProductIdIdx] ?? "").trim() ===
          variantProductId
        ) {
          const raw = String(
            (productValues[i] as string[])[pWooIdIdx] ?? "",
          ).trim();
          parentWooId = raw ? Number(raw) : null;
          break;
        }
      }
    }
  }

  // Count sibling variants (same product_id, excluding this row) to know if this is the last one
  const siblingCount = variantProductId
    ? (() => {
        const pidIdx = colByHeader(variantHeaders, "product_id");
        let count = 0;
        for (let i = 1; i < variantValues.length; i++) {
          if (i === variantRowIdx) continue;
          if (
            String((variantValues[i] as string[])[pidIdx] ?? "").trim() ===
            variantProductId
          )
            count++;
        }
        return count;
      })()
    : -1;
  const wasLastVariant = siblingCount === 0;

  const skus = new Set([sku]);
  const descRowIndices = findRowIndicesBySku(descRes.data.values ?? [], skus);
  const invRowIndices = findRowIndicesBySku(invRes.data.values ?? [], skus);

  await deleteSheetRows(sheets, spreadsheetId, sheetIdByName, [
    { sheetName: "variants", indices: [variantRowIdx] },
    { sheetName: "descriptions", indices: descRowIndices },
    { sheetName: "inventory_index", indices: invRowIndices },
  ]);

  return {
    descriptionsDeleted: descRowIndices.length,
    inventoryIndexDeleted: invRowIndices.length,
    wooVariantId,
    parentWooId,
    wasLastVariant,
    productId: variantProductId,
  };
}

async function lookupSelectProduct(
  sheets: SheetsClient,
  spreadsheetId: string,
  productId: string,
): Promise<string> {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "productList",
  });
  const entries = ((response.data.values ?? []) as string[][])
    .map((r) => String(r[0] ?? "").trim())
    .filter(Boolean);

  const match = entries.find((entry) => entry.endsWith(` - ${productId}`));
  if (!match)
    throw new Error(`No productList entry found for product_id "${productId}"`);
  return match;
}

async function pollForVariantSkus(
  sheets: SheetsClient,
  spreadsheetId: string,
  startSheetRow: number,
  count: number,
  timeoutMs = 30_000,
): Promise<string[]> {
  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "variants!1:1",
  });
  const headers = ((headerResponse.data.values?.[0] ?? []) as string[]).map(
    (h) => String(h).trim(),
  );
  const skuIdx = colByHeader(headers, "sku");
  const lastCol = colLetter(headers.length - 1);
  const endRow = startSheetRow + count - 1;

  const deadline = Date.now() + timeoutMs;
  let delay = 800;

  while (Date.now() < deadline) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `variants!A${startSheetRow}:${lastCol}${endRow}`,
    });
    const rows = (res.data.values ?? []) as string[][];
    if (rows.length === count) {
      const skus = rows.map((r) => String(r[skuIdx] ?? "").trim());
      if (skus.every((s) => s)) return skus;
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(Math.floor(delay * 1.5), 4000);
  }

  throw new Error(
    `Timeout waiting for variant SKU formulas at rows ${startSheetRow}–${endRow}`,
  );
}

export interface VariantComboShared {
  design?: string;
  designVariant?: string;
  priceVariant?: string;
  weightOzVariant?: string;
  descriptionVariant?: string;
  stockQty?: number;
}

export function buildVariantCombos(
  colors: string[],
  sizes: string[],
  dimensions: string[],
  shared: VariantComboShared,
) {
  let combos: Array<{ color?: string; size?: string; dimension?: string }> = [
    {},
  ];
  if (colors.length)
    combos = combos.flatMap((c) => colors.map((color) => ({ ...c, color })));
  if (sizes.length)
    combos = combos.flatMap((c) => sizes.map((size) => ({ ...c, size })));
  if (dimensions.length)
    combos = combos.flatMap((c) =>
      dimensions.map((dimension) => ({ ...c, dimension })),
    );
  return combos.map((c) => ({ ...c, ...shared }));
}

export async function createVariantRows(
  sheets: SheetsClient,
  spreadsheetId: string,
  productId: string,
  variants: Array<{
    color?: string;
    size?: string;
    dimension?: string;
    design?: string;
    designVariant?: string;
    descriptionVariant?: string;
    priceVariant?: string;
    weightOzVariant?: string;
    stockQty?: number;
  }>,
): Promise<{ skus: string[] }> {
  if (!variants.length) return { skus: [] };

  const selectProductValue = await lookupSelectProduct(
    sheets,
    spreadsheetId,
    productId,
  );

  const variantsData = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "variants_values",
  });
  const values = variantsData.data.values ?? [];
  if (!values.length) throw new Error("variants sheet returned no data");

  const headers = (values[0] as string[]).map((h) => String(h).trim());
  const colIdx = (name: string) => headers.indexOf(name);
  const startSheetRow = values.length + 1;

  const spIdx = colIdx("select_product");
  if (spIdx === -1)
    throw new Error('variants sheet missing "select_product" column');

  // Pre-write dupe guard — check before touching the sheet.
  // Key fields match the SKU formula: color + design_variant (graphicsVariant code column) +
  // dimensions OR size. The 'design' field is the artwork name — it is NOT in the SKU formula.
  {
    const norm = (v: string | null | undefined) =>
      (v ?? "").toLowerCase().trim();
    const pidIdx = colByHeader(headers, "product_id");
    const colIdx2 = colByHeader(headers, "color");
    const dvIdx = colByHeader(headers, "design_variant");
    const dimIdx = colByHeader(headers, "dimensions");
    const sizeIdx = colByHeader(headers, "size");

    const existingCombos = new Set<string>();
    for (let i = 1; i < values.length; i++) {
      const row = values[i] as string[];
      if (norm(row[pidIdx]) !== productId.toLowerCase()) continue;
      existingCombos.add(
        variantDupeKey({
          color: row[colIdx2],
          designVariant: row[dvIdx],
          dimension: row[dimIdx],
          size: row[sizeIdx],
        }),
      );
    }

    const seen = new Set<string>();
    for (const v of variants) {
      const key = variantDupeKey({
        color: v.color,
        designVariant: v.designVariant,
        dimension: v.dimension,
        size: v.size,
      });
      if (existingCombos.has(key) || seen.has(key)) {
        throw new Error(
          `Variant with this combination already exists: color="${v.color ?? ""}" designVariant="${v.designVariant ?? ""}" dimension="${v.dimension ?? ""}" size="${v.size ?? ""}". No rows were written.`,
        );
      }
      seen.add(key);
    }
  }

  // Captured alongside rowData so a rollback (if a later step fails) can
  // find these exact rows again by their own generated UUID instead of
  // trusting startSheetRow to still point at them — see
  // rollbackPartialVariantCreate's comment for why position isn't safe.
  const newRowIds: string[] = [];
  const rowIdColIdx = colIdx("row_id");
  const rowData: string[][] = variants.map(
    ({
      color,
      size,
      dimension,
      design,
      designVariant,
      priceVariant,
      weightOzVariant,
    }) => {
      const row = new Array(headers.length).fill("");
      row[spIdx] = selectProductValue;
      const ci = colIdx("color");
      if (ci >= 0 && color) row[ci] = color;
      const si = colIdx("size");
      if (si >= 0 && size) row[si] = size;
      const dimi = colIdx("dimensions");
      if (dimi >= 0 && dimension) row[dimi] = dimension;
      const desi = colIdx("design");
      if (desi >= 0 && design) row[desi] = design;
      const di = colIdx("design_variant");
      if (di >= 0 && designVariant) row[di] = designVariant;
      const pi = colIdx("price_variant");
      if (pi >= 0 && priceVariant) row[pi] = priceVariant;
      const wi = colIdx("weight_oz_variant");
      if (wi >= 0 && weightOzVariant) row[wi] = weightOzVariant;
      if (rowIdColIdx >= 0) {
        const generatedId = crypto.randomUUID();
        row[rowIdColIdx] = generatedId;
        newRowIds.push(generatedId);
      }
      return row;
    },
  );

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [{ range: `variants!A${startSheetRow}`, values: rowData }],
    },
  });

  let skus: string[];
  try {
    skus = await pollForVariantSkus(
      sheets,
      spreadsheetId,
      startSheetRow,
      variants.length,
    );
  } catch (error) {
    await rollbackPartialVariantCreate(
      sheets,
      spreadsheetId,
      newRowIds,
    ).catch((rollbackErr) =>
      console.error(
        "create_variants: rollback after sku-poll failure also failed:",
        rollbackErr,
      ),
    );
    throw new Error(
      `Variant creation failed before it could complete (${(error as Error).message}). The incomplete row(s) were removed — please review your entries and try again.`,
    );
  }

  // Post-write safety net: the sheet formula resolved actual SKUs — check they're unique.
  // If a collision is found, we locate the newly-written row BY SKU (not by position),
  // confirm there are exactly 2 rows with that SKU, and delete the new one.
  // If we cannot positively identify the duplicate, we leave the sheet intact and
  // surface the conflict so a human can investigate.
  // Also builds inventory_index names from the sheet's own resolved readable_name/
  // product_name/variant_details columns, since we're already reading this row —
  // ensureInventoryIndexRowsExist below needs real names, not a blank map, or newly
  // created variants get a permanently-blank product_name (nothing backfills it later).
  const variantCatalogNameBySku = new Map<string, string>();
  {
    const allVariantsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "variants_values",
    });
    const allRows = (allVariantsRes.data.values ?? []) as string[][];
    if (allRows.length > 1) {
      const hdr = allRows[0].map((h) => String(h).trim());
      const skuCol = colByHeader(hdr, "sku");
      const readableNameCol = hdr.indexOf("readable_name");
      const productNameCol = hdr.indexOf("product_name");
      const variantDetailsCol = hdr.indexOf("variant_details");

      // Build sku → [data indices] map for every row
      const skuToIndices = new Map<string, number[]>();
      for (let i = 1; i < allRows.length; i++) {
        const s = String(allRows[i][skuCol] ?? "").trim();
        if (!s) continue;
        if (!skuToIndices.has(s)) skuToIndices.set(s, []);
        skuToIndices.get(s)!.push(i);
      }

      for (const sku of skus) {
        const idx = skuToIndices.get(sku)?.[0];
        if (idx == null) continue;
        const readable =
          readableNameCol >= 0
            ? String(allRows[idx][readableNameCol] ?? "").trim()
            : "";
        const productName =
          productNameCol >= 0
            ? String(allRows[idx][productNameCol] ?? "").trim()
            : "";
        const variantDetails =
          variantDetailsCol >= 0
            ? String(allRows[idx][variantDetailsCol] ?? "").trim()
            : "";
        const name =
          readable ||
          [productName, variantDetails].filter(Boolean).join(" | ") ||
          sku;
        variantCatalogNameBySku.set(sku, name);
      }

      const dupeSkus = skus.filter(
        (s) => s && (skuToIndices.get(s)?.length ?? 0) > 1,
      );
      if (dupeSkus.length) {
        const colorCol = hdr.indexOf("color");
        const dvCol = hdr.indexOf("design_variant");
        const dimCol = hdr.indexOf("dimensions");
        const sizeCol = hdr.indexOf("size");

        const rowLabel = (dataIdx: number) =>
          [
            String(allRows[dataIdx]?.[colorCol] ?? ""),
            String(allRows[dataIdx]?.[dvCol] ?? ""),
            String(allRows[dataIdx]?.[dimCol] ?? ""),
            String(allRows[dataIdx]?.[sizeCol] ?? ""),
          ]
            .filter(Boolean)
            .join(" / ") || `row ${dataIdx + 1}`;

        const conflicts: DupeSkuConflict[] = [];
        const unresolvable: string[] = [];

        for (const dupeSku of dupeSkus) {
          const indices = skuToIndices.get(dupeSku)!;
          const newIndices = indices.filter(
            (i) =>
              i + 1 >= startSheetRow && i + 1 < startSheetRow + skus.length,
          );
          if (newIndices.length === 1 && indices.length === 2) {
            const newIdx = newIndices[0];
            const existingIdx = indices.find((i) => i !== newIdx)!;
            conflicts.push({
              sku: dupeSku,
              existing: {
                dataIndex: existingIdx,
                label: rowLabel(existingIdx),
              },
              new: { dataIndex: newIdx, label: rowLabel(newIdx) },
            });
          } else {
            unresolvable.push(dupeSku);
          }
        }

        if (unresolvable.length) {
          const allDupes = [...new Set(dupeSkus)];
          throw new Error(
            `Variant SKU collision (${allDupes.join(", ")}): the sheet formula produced an SKU that already exists. Could not safely identify duplicate rows — check the variants sheet for duplicate rows and remove the extra one manually.`,
          );
        }
        if (conflicts.length) {
          throw new DupeSkuError(conflicts);
        }
      }
    }
  }

  const invState = await loadInventoryIndexState(sheets, spreadsheetId);
  const invUpdates = skus.map((sku, i) => {
    const fields: Record<string, number | string> = {};
    if (variants[i].stockQty !== undefined)
      fields.stock_qty = variants[i].stockQty as number;
    return { sku, fields };
  });
  try {
    await Promise.all([
      Promise.all(
        skus.map((sku, i) =>
          updateDescriptionFields(sheets, spreadsheetId, sku, {
            descriptionVariant: variants[i].descriptionVariant,
          }),
        ),
      ),
      ensureInventoryIndexRowsExist(
        sheets,
        spreadsheetId,
        invState,
        invUpdates,
        variantCatalogNameBySku,
      ),
    ]);
  } catch (error) {
    await rollbackPartialVariantCreate(
      sheets,
      spreadsheetId,
      newRowIds,
      skus,
    ).catch((rollbackErr) =>
      console.error(
        "create_variants: rollback after description/inventory write failure also failed:",
        rollbackErr,
      ),
    );
    throw new Error(
      `Variant creation failed before it could complete (${(error as Error).message}). The incomplete row(s) were removed — please review your entries and try again.`,
    );
  }

  return { skus };
}

// Rolls back a create_variants request that wrote rows (the batchUpdate
// above) but failed on a later step — pollForVariantSkus timing out (sku
// formula never resolved), or the final description/inventory_index writes
// failing after skus did resolve.
//
// Looks the rows up by row_id, NOT by the startSheetRow position they had
// at write time — same reasoning as rollbackPartialProductCreate: another
// request could shift rows around before this runs, and a stale position
// risks deleting the wrong (possibly live) variants. row_id is a UUID we
// generate ourselves per row before ever writing it (see createVariantRows'
// `newRowIds`), so rollback re-reads the sheet fresh and matches on that.
//
// Pass `skus` only when they're actually known (post-poll failures) so any
// descriptions/inventory_index rows that did get written are cleaned up
// too; omit it for a pre-poll failure where nothing downstream could have
// been written yet.
export async function rollbackPartialVariantCreate(
  sheets: SheetsClient,
  spreadsheetId: string,
  rowIds: string[],
  skus?: string[],
): Promise<void> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheetIdByName = new Map(
    (meta.data.sheets ?? []).map((s) => [
      s.properties?.title ?? "",
      s.properties?.sheetId ?? 0,
    ]),
  );

  const rowIdSet = new Set(rowIds.filter(Boolean));
  let variantIndices: number[] = [];
  if (rowIdSet.size) {
    const variantsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "variants_values",
    });
    const variantValues = variantsRes.data.values ?? [];
    const variantHeaders = ((variantValues[0] as string[]) ?? []).map((h) =>
      String(h).trim(),
    );
    const rowIdCol = colByHeader(variantHeaders, "row_id");
    variantIndices = variantValues
      .map((row, i) => ({ row: row as string[], i }))
      .filter(
        ({ row, i }) =>
          i > 0 && rowIdSet.has(String(row[rowIdCol] ?? "").trim()),
      )
      .map(({ i }) => i);
  }

  const targets: Array<{ sheetName: string; indices: number[] }> = [
    { sheetName: "variants", indices: variantIndices },
  ];

  const skuSet = new Set((skus ?? []).filter(Boolean));
  if (skuSet.size) {
    const [descRes, invRes] = await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId, range: "descriptions" }),
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: "inventory_index",
      }),
    ]);
    targets.push(
      {
        sheetName: "descriptions",
        indices: findRowIndicesBySku(descRes.data.values ?? [], skuSet),
      },
      {
        sheetName: "inventory_index",
        indices: findRowIndicesBySku(invRes.data.values ?? [], skuSet),
      },
    );
  }

  await deleteSheetRows(sheets, spreadsheetId, sheetIdByName, targets);
}

// sessions headers:       timestamp | email | name | given_name | family_name | role | action | env
// merch_app_logs headers: timestamp | email | action | detail | env
// bug_reports headers:    timestamp | email | page | severity | what_happened | what_did_you_expect | what_had_you_done_before | screenshot_link | env
// Add these as row 1 manually in each sheet once — writeSheetLog only appends data rows.
export async function writeSheetLog(
  sheets: SheetsClient,
  spreadsheetId: string,
  sheetName: "sessions" | "merch_app_logs" | "bug_reports",
  row: string[],
): Promise<void> {
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: sheetName,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export interface ActivityLogEntry {
  timestamp: string;
  email: string;
  action: string;
  detail: string;
}

// Reads the most recent N rows from merch_app_logs, newest first. Positional
// (not header-name) column access — matches the fixed [timestamp, email,
// action, detail, env] array shape every writeSheetLog("merch_app_logs", ...)
// call already uses, so this can't drift from a header rename.
export async function getRecentActivity(
  sheets: SheetsClient,
  spreadsheetId: string,
  limit: number,
): Promise<ActivityLogEntry[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "merch_app_logs",
  });
  const values = res.data.values ?? [];
  if (values.length <= 1) return [];

  return values
    .slice(1)
    .slice(-limit)
    .reverse()
    .map((row) => ({
      timestamp: String((row as string[])[0] ?? ""),
      email: String((row as string[])[1] ?? ""),
      action: String((row as string[])[2] ?? ""),
      detail: String((row as string[])[3] ?? ""),
    }));
}

// Reads the "sessions" log (written on every login/logout, [timestamp,
// email, name, given_name, family_name, role, action, env]) to build an
// email -> given name map — no Drive API permissions lookup needed, we
// already capture this ourselves at login (straight from Google's own
// given_name field, not a whitespace split of the full name — "Mary Lou"
// stays "Mary Lou", not "Mary"). Only reads the first 4 columns; family_name
// onward is irrelevant here. Rows logged before the given_name column
// existed fall back to splitting the full name, wrong for compound first
// names but better than nothing for old data.
export async function getEmailNameMap(
  sheets: SheetsClient,
  spreadsheetId: string,
): Promise<Map<string, string>> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: "sessions",
  });
  const values = res.data.values ?? [];
  const map = new Map<string, string>();
  for (const row of values.slice(1)) {
    const email = String((row as string[])[1] ?? "").trim();
    const name = String((row as string[])[2] ?? "").trim();
    const givenName = String((row as string[])[3] ?? "").trim();
    const resolved = givenName || (name ? name.split(" ")[0] : "");
    if (email && resolved) map.set(email.toLowerCase(), resolved);
  }
  return map;
}

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
    salePriceDollars: toNullableString(row.sale_price_dollars),
    salePriceVariant: toNullableString(row.sale_price_variant),
    salePriceCents: toNullableString(row.sale_price_cents),
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
    salePriceDollars: toNullableString(product.sale_price_dollars),
    publishedStatus: toNullableString(product.published_status),
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
    contentUnsynced: false,

    rowCount: 0,
    rows: [],
  };
}

export function buildConflictGroups(
  groups: CatalogGroup[],
): CatalogConflictGroup[] {
  return groups
    .map((group) => {
      // A product with no wooId has no real Woo stock to conflict with —
      // matches the per-row `data-mismatch` indicator on the Inventory
      // page, which already gates on `!!group.wooId` for the same reason.
      if (!group.wooId) return null;

      // Simple products (no variant rows) track stock on the group itself,
      // not in `rows` — checking only `rows` silently ignored every simple
      // product's own mismatch. Mirrors the Inventory page's per-row check.
      const count =
        group.rows.length > 0
          ? group.rows.filter((row) => row.stockQty !== row.wooStock).length
          : group.stockQty !== group.wooStock
            ? 1
            : 0;

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

  // Sheet row order is no longer a reliable proxy for product_id order —
  // product_id is self-assigned per-category max+1 now (not a live formula
  // tied to row position), and a new create just appends wherever the next
  // blank row happens to be, which can land anywhere relative to older rows
  // that were shuffled by earlier deletes (e.g. HME-0005, HME-0001, HME-0006
  // in raw sheet order). Sort explicitly by sku so every page reading off
  // this catalog shows a stable, predictable order instead of whatever the
  // sheet's current row order happens to be.
  const groups = Array.from(groupsMap.values())
    .map((group) => {
      group.rows.sort(compareCatalogRows);
      group.rowCount = group.rows.length;
      return group;
    })
    .sort((a, b) => normalizeSortValue(a.sku).localeCompare(normalizeSortValue(b.sku)));

  const conflictGroups = buildConflictGroups(groups);

  const unsyncedCount = groups.reduce((total, group) => {
    return (
      total + group.rows.filter((row) => row.stockQty !== row.wooStock).length
    );
  }, 0);

  let contentUnsyncedCount = 0;
  for (const group of groups) {
    const unsynced =
      !!group.wooId &&
      !!group.lastHash &&
      computeProductSyncHash(group) !== group.lastHash;
    group.contentUnsynced = unsynced;
    if (unsynced) contentUnsyncedCount++;
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    summary: {
      productCount: groups.length,
      groupCount: groups.length,
      rowCount: groups.reduce((total, group) => total + group.rowCount, 0),
      unsyncedCount,
      contentUnsyncedCount,
      conflictGroups,
    },
    groups,
  };
}

function normalizeSortValue(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
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

  const sizeRankCompare = sizeRank(a.size) - sizeRank(b.size);
  if (sizeRankCompare !== 0) return sizeRankCompare;

  const sizeTextCompare = normalizeSortValue(a.size).localeCompare(
    normalizeSortValue(b.size),
  );
  if (sizeTextCompare !== 0) return sizeTextCompare;

  return normalizeSortValue(a.variantId).localeCompare(
    normalizeSortValue(b.variantId),
  );
}

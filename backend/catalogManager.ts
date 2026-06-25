import { createHash } from "crypto";
import { sizeRank } from "~/utils/sizeUtils";
import {
  ensureInventoryIndexRowsExist,
  loadInventoryIndexState,
  getWooConfig,
  buildWooUrl,
} from "./inventoryManager";
import type { WooConfig } from "./inventoryManager";
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

function colByHeader(headers: string[], name: string): number {
  const idx = headers.indexOf(name);
  if (idx === -1) throw new Error(`Sheet missing required column "${name}"`);
  return idx;
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
  const existingValues = (vrs[0]?.values ?? []).flat().map(String).filter(Boolean);
  const existingCodes = (vrs[1]?.values ?? []).flat().map(String).filter(Boolean);

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
  console.log(`[createWooCategory] HTTP ${res.status}:`, responseText);

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

export async function appendCategoryEntry(
  sheets: SheetsClient,
  spreadsheetId: string,
  type: "category" | "subcategory",
  value: string,
  code: string,
  wooId: number,
  label?: string,
): Promise<void> {
  const valueRange = type === "category" ? "catList" : "subCatList";
  const codeRange = type === "category" ? "catCode" : "subCatCode";
  const wooIdRange = type === "category" ? "catId" : "subCatId";
  const labelRange = type === "subcategory" ? "subCatLabel" : null;

  const rangesToRead = [
    valueRange,
    codeRange,
    wooIdRange,
    ...(labelRange ? [labelRange] : []),
  ];

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: rangesToRead,
  });

  const vrs = response.data.valueRanges ?? [];
  const existingValues = (vrs[0]?.values ?? [])
    .flat()
    .map(String)
    .filter(Boolean);
  const existingCodes = (vrs[1]?.values ?? [])
    .flat()
    .map(String)
    .filter(Boolean)
    .map((c) => c.toUpperCase());

  if (existingValues.some((v) => v.toLowerCase() === value.toLowerCase())) {
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

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}

// Convert 0-based column index to A1 column letter (A, B, ..., Z, AA, AB, ...)
function colLetter(idx: number): string {
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

  // Write only the user-provided cells — never touch formula/protected columns
  const cell = (name: string, value: string) => ({
    range: `products!${colLetter(col(name))}${sheetRow}`,
    values: [[value]],
  });

  const writes = [
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
  if (rowIdx === 1)
    throw new Error(
      `Product SKU "${sku}" is in the protected row 2 and cannot be edited`,
    );

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
  if (rowIdx === 1)
    throw new Error(
      `Variant SKU "${sku}" is in the protected row 2 and cannot be edited`,
    );

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
    category: group.subcategoryCode || group.subcategory || "",
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
        regular_price: v.priceDollars || "",
        sku: v.sku,
        stock_quantity: v.stockQty ?? 0,
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
      console.warn(`writeProductSyncHashes: no writable row for SKU ${sku} — in protected row 2 or not found; hash not saved`);
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

  let productRowIdx = -1;
  let productId = "";
  for (let i = 1; i < productValues.length; i++) {
    if (String((productValues[i] as string[])[pSkuIdx] ?? "").trim() === sku) {
      productRowIdx = i;
      productId = String(
        (productValues[i] as string[])[pProductIdIdx] ?? "",
      ).trim();
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

  return {
    variantsDeleted: variantRowIndices.length,
    descriptionsDeleted: descRowIndices.length,
    inventoryIndexDeleted: invRowIndices.length,
  };
}

export async function deleteVariant(
  sheets: SheetsClient,
  spreadsheetId: string,
  sku: string,
): Promise<{
  descriptionsDeleted: number;
  inventoryIndexDeleted: number;
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

  const [variantsRes, descRes, invRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId, range: "variants_values" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "descriptions" }),
    sheets.spreadsheets.values.get({ spreadsheetId, range: "inventory_index" }),
  ]);

  const variantValues = variantsRes.data.values ?? [];
  if (variantValues.length < 2) throw new Error("variants sheet is empty");
  const variantHeaders = (variantValues[0] as string[]).map((h) =>
    String(h).trim(),
  );
  const vSkuIdx = colByHeader(variantHeaders, "sku");

  let variantRowIdx = -1;
  for (let i = 1; i < variantValues.length; i++) {
    if (String((variantValues[i] as string[])[vSkuIdx] ?? "").trim() === sku) {
      variantRowIdx = i;
      break;
    }
  }
  if (variantRowIdx === -1) throw new Error(`Variant SKU "${sku}" not found`);
  if (variantRowIdx === 1)
    throw new Error(
      `Variant SKU "${sku}" is in the protected row 2 and cannot be deleted through this tool`,
    );

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

  const rowData: string[][] = variants.map(
    ({ color, size, dimension, design, designVariant, priceVariant, weightOzVariant }) => {
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
      const ri = colIdx("row_id");
      if (ri >= 0) row[ri] = crypto.randomUUID();
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

  const skus = await pollForVariantSkus(
    sheets,
    spreadsheetId,
    startSheetRow,
    variants.length,
  );

  const invState = await loadInventoryIndexState(sheets, spreadsheetId);
  const invUpdates = skus.map((sku, i) => {
    const fields: Record<string, number | string> = {};
    if (variants[i].stockQty !== undefined)
      fields.stock_qty = variants[i].stockQty as number;
    return { sku, fields };
  });
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
      new Map(),
    ),
  ]);

  return { skus };
}

// sessions headers:       timestamp | email | name | role | action | env
// merch_app_logs headers: timestamp | email | action | detail | env
// Add these as row 1 manually in each sheet once — writeSheetLog only appends data rows.
export async function writeSheetLog(
  sheets: SheetsClient,
  spreadsheetId: string,
  sheetName: "sessions" | "merch_app_logs",
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

    rowCount: 0,
    rows: [],
  };
}

export function buildConflictGroups(
  groups: CatalogGroup[],
): CatalogConflictGroup[] {
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

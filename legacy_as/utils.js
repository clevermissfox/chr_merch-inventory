function getSheetNames() {
  const props = PropertiesService.getScriptProperties();
  return {
    productsSheetName: props.getProperty("PRODUCTS_SHEET_NAME") || "products",
    variantsSheetName: props.getProperty("VARIANTS_SHEET_NAME") || "variants",
    categorySheetName: props.getProperty("CATEGORY_SHEET_NAME") || "category",
    subcategorySheetName:
      props.getProperty("SUBCATEGORY_SHEET_NAME") || "subcategory",
    descriptionsSheetName:
      props.getProperty("DESCRIPTIONS_SHEET_NAME") || "descriptions",
    inventorySheetName:
      props.getProperty("INVENTORY_SHEET_NAME") || "inventory_index",
  };
}

function getWooConfig() {
  const isTesting = false;
  const props = PropertiesService.getScriptProperties();
  if (isTesting) {
    return {
      storeUrl: props.getProperty("BASE_STAGING_URL"),
      consumerKey: props.getProperty("WOO_STAGING_CONSUMER_KEY"),
      consumerSecret: props.getProperty("WOO_STAGING_CONSUMER_SECRET"),
    };
  } else {
    return {
      storeUrl: props.getProperty("BASE_PROD_URL"),
      consumerKey: props.getProperty("WOO_PROD_CONSUMER_KEY"),
      consumerSecret: props.getProperty("WOO_PROD_CONSUMER_SECRET"),
    };
  }
}

function getSyncFlags(pushStockOverride) {
  if (typeof pushStockOverride === "boolean") {
    return { pushStock: pushStockOverride };
  }
  const props = PropertiesService.getScriptProperties();
  const raw = (props.getProperty("PUSH_STOCK") || "false").toLowerCase();
  return { pushStock: raw === "true" };
}

// Helper: normalize to "12.34" as string
function normalizePriceCell(value) {
  if (value === "" || value == null) return "";
  if (typeof value === "number") return value.toFixed(2);
  const str = String(value);
  const cleaned = str.replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const num = parseFloat(cleaned);
  if (isNaN(num)) return "";
  return num.toFixed(2);
}

function normalizeWeight(ozCell) {
  const toNum = (v) => {
    if (v === "" || v == null) return 0;
    const cleaned = String(v).replace(/[^0-9.]/g, "");
    if (!cleaned) return 0;
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  };

  const oz = toNum(ozCell);
  if (oz === 0) return "";

  const lbs = oz / 16;
  return lbs.toFixed(3); // EXACT same unit as before
}

function normalizeDimCell(v) {
  if (v === "" || v == null) return "";
  const cleaned = String(v).replace(/[^0-9.]/g, "");
  if (!cleaned) return "";
  const num = parseFloat(cleaned);
  if (isNaN(num)) return "";
  // no fixed required, but keep it clean
  return String(num);
}

function assertNoVariationAttributeCollisions(products, opts) {
  opts = opts || {};
  const hardStop = !!opts.hardStop; // throw on issues
  const logAll = opts.logAll !== false; // default true
  const notifyEmail = !!opts.notifyEmail; // email on issues
  const logFn = opts.logFn || logBoth || Logger.log;

  let issues = 0;
  const lines = [];

  const logLine = (s) => {
    if (!logAll) return;
    lines.push(s);
    try {
      logFn(s);
    } catch (e) {
      Logger.log(String(s));
    }
  };

  products.forEach((p) => {
    const hasVariants = Array.isArray(p.variations) && p.variations.length > 0;
    if (!hasVariants) return;

    const expectedAttrNames = (p.attributes || [])
      .filter((a) => a && a.variation)
      .map((a) => String(a.name).trim())
      .filter(Boolean);

    const seen = {}; // signature -> [sku...]
    const missingBySku = {}; // sku -> [missing names]

    p.variations.forEach((v) => {
      const sku = v.sku || "(no sku)";

      const attrMap = {};
      (v.attributes || []).forEach((a) => {
        if (!a) return;
        const n = a.name != null ? String(a.name).trim() : "";
        const o = a.option != null ? String(a.option).trim() : "";
        if (n && o) attrMap[n] = o;
      });

      const missing = expectedAttrNames.filter((n) => !attrMap[n]);
      if (missing.length) {
        issues += 1;
        missingBySku[sku] = missing;
      }

      const signature = Object.keys(attrMap)
        .sort()
        .map((n) => `${n}=${attrMap[n]}`)
        .join("|");

      if (expectedAttrNames.length > 0 && !signature) {
        issues += 1;
        if (!missingBySku[sku]) missingBySku[sku] = expectedAttrNames.slice();
      }

      if (!seen[signature]) seen[signature] = [];
      seen[signature].push(sku);
    });

    Object.keys(seen).forEach((sig) => {
      if (seen[sig].length > 1) {
        issues += 1;
        logLine(`❌ COLLISION: ${p.productId} (${p.name})`);
        logLine(`   Signature: ${sig || "(empty attributes)"}`);
        logLine(`   SKUs: ${seen[sig].join(", ")}`);
        logLine(
          `   Fix: add another distinguishing attribute OR make the existing attribute option unique.`,
        );
      }
    });

    Object.keys(missingBySku).forEach((sku) => {
      logLine(
        `⚠️ MISSING ATTRS: ${p.productId} (${p.name}) SKU ${sku} missing: ${missingBySku[sku].join(", ")}`,
      );
    });
  });

  if (issues === 0) {
    logLine(
      "✅ No variation attribute collisions or missing-attribute issues found.",
    );
    return true;
  }

  const msg = `Variation collision check found ${issues} issue(s). See logs sheet.`;
  logLine(`⚠️ ${msg}`);

  if (notifyEmail) {
    const body = lines.slice(0, 200).join("\n"); // avoid huge emails
    emailNotify(
      "Woo Sync: Variation Collision Detected",
      body,
      "dev@cochiseharmreduction.org",
      false,
    );
  }

  if (hardStop) throw new Error(msg);
  return false;
}

function debugBuildProducts() {
  const products = buildProductsFromSheet();
  Logger.log(JSON.stringify(products, null, 2));
  logJsonObject(products);
}

function testCollisionCheck() {
  const products = buildProductsFromSheet();
  assertNoVariationAttributeCollisions(products, {
    hardStop: false,
    notifyEmail: false,
    logFn: logBoth,
  });
}

function logMessage(message) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName("logs") || ss.insertSheet("logs");
    sheet.appendRow([new Date(), message]);
  } catch (e) {
    // In case logging fails, ignore but optionally use Logger.log for dev
    Logger.log("Logging to Sheet failed: " + e.message);
  }
}

function logJsonObject(obj) {
  const ss = SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName("logs") || ss.insertSheet("logs");

  const json = JSON.stringify(obj, null, 2); // pretty format
  sheet.appendRow([new Date(), json]); // store the string as a single cell
}

function logBoth(message) {
  Logger.log("LogBoth Message: " + message);
  logMessage(message);
}

function emailNotify(
  subject,
  msg,
  emailTo = "dev@cochiseharmreduction.org",
  throwError = false,
) {
  const emailAddress = emailTo;

  const timestamp = new Date().toISOString();
  const fullMessage = `Notification sent at ${timestamp}:\n\n${msg}`;

  try {
    MailApp.sendEmail(emailAddress, subject, fullMessage);
  } catch (emailError) {
    Logger.log("Failed to send email notification: " + emailError.message);
  }

  if (throwError) {
    throw new Error(msg);
  }
}

function stableStringify(obj) {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);

  if (Array.isArray(obj)) {
    return "[" + obj.map(stableStringify).join(",") + "]";
  }

  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

function hashObject(obj) {
  const json = stableStringify(obj);
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    json,
  );
  return bytes
    .map((b) => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"))
    .join("");
}

function computeProductSyncHash(p) {
  const core = {
    skuRoot: p.skuRoot,
    name: p.name || "",
    description: p.description || "",
    short_description: p.short_description || "",
    categories: (p.categories || []).map((c) => ({ id: c.id })),
    attributes: (p.attributes || []).map((a) => ({
      name: a.name,
      variation: !!a.variation,
      options: (a.options || []).slice().sort(),
    })),
    shipping: {
      weight: p.weight || "",
      width: p.shipping_width || "",
      height: p.shipping_height || "",
      depth: p.shipping_depth || "",
    },
    variations: (p.variations || [])
      .map((v) => ({
        sku: v.sku,
        regular_price: v.regular_price || "",
        stock_quantity: parseInt(v.stock_quantity, 10) || 0,
        attributes: (v.attributes || []).map((a) => ({
          name: a.name,
          option: a.option,
        })),
        description: v.description || "",
        weight: v.weight || "",
        dims: {
          length: v.length || "",
          width: v.width || "",
          height: v.height || "",
        },
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  };

  return hashObject(core);
}

function sanitizeHtml(html) {
  let s = String(html);

  // Remove dangerous block tags entirely
  s = s.replace(
    /<\s*(script|style|iframe)[\s\S]*?>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    "",
  );

  // Remove inline event handlers (onclick, onerror, etc.)
  s = s.replace(/\son\w+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, "");

  // Neutralize javascript: URLs
  s = s.replace(/\shref\s*=\s*("|\')\s*javascript:[\s\S]*?\1/gi, ' href="#"');

  return s.trim();
}

function formatText(text) {
  if (text == null) return "";
  const t = String(text).trim();
  if (!t) return "";

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(t);

  return looksLikeHtml
    ? sanitizeHtml(t) // HTML input → sanitized
    : safeMarkdownToHtml(t); // text/markdown → escaped + formatted
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeMarkdownToHtml(text) {
  if (text == null) return "";

  // normalize
  let t = String(text).replace(/\r\n/g, "\n").trim();
  if (!t) return "";

  // 🔐 STEP 1: escape everything
  t = escapeHtml(t);

  // ✨ STEP 2: controlled markdown (SAFE because content is escaped)
  t = t.replace(/^###\s*(.+)$/gm, "<h3>$1</h3>");
  t = t.replace(/^##\s*(.+)$/gm, "<h2>$1</h2>");
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 🧱 STEP 3: paragraphs + line breaks
  return t
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function variationSignature_(attrs) {
  const map = {};
  (attrs || []).forEach((a) => {
    const n = a && a.name != null ? String(a.name).trim() : "";
    const o = a && a.option != null ? String(a.option).trim() : "";
    if (n) map[n] = o;
  });
  return Object.keys(map)
    .sort()
    .map((k) => `${k}=${map[k]}`)
    .join("|");
}

/**
 * Build a unique sorted SKU list from products + variants sheets.
 * Assumes there is a column named "sku" on BOTH sheets.
 */
function collectAllSkus_() {
  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();

  const productsSheet = ss.getSheetByName(names.productsSheetName);
  const variantsSheet = ss.getSheetByName(names.variantsSheetName);
  if (!productsSheet || !variantsSheet)
    throw new Error("Missing products or variants sheet");

  const getColIndex = (headers, name, sheetName) => {
    const idx = headers.indexOf(name);
    if (idx === -1) throw new Error(`Missing "${name}" on sheet ${sheetName}`);
    return idx;
  };

  const skus = new Set();

  // products
  {
    const data = productsSheet.getDataRange().getValues();
    if (data.length > 1) {
      const headers = data[0].map((h) => String(h).trim());
      const idxSku = getColIndex(headers, "sku", names.productsSheetName);
      for (let r = 1; r < data.length; r++) {
        const sku = String(data[r][idxSku] || "").trim();
        if (sku) skus.add(sku);
      }
    }
  }

  // variants
  {
    const data = variantsSheet.getDataRange().getValues();
    if (data.length > 1) {
      const headers = data[0].map((h) => String(h).trim());
      const idxSku = getColIndex(headers, "sku", names.variantsSheetName);
      for (let r = 1; r < data.length; r++) {
        const sku = String(data[r][idxSku] || "").trim();
        if (sku) skus.add(sku);
      }
    }
  }

  return Array.from(skus).sort();
}

function countOrphanSkuRows_(sh, skuList, skuHeaderName) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return 0;

  const headers = data[0].map((h) => String(h).trim());
  const idxSku = headers.indexOf(skuHeaderName);
  if (idxSku === -1) {
    throw new Error(
      `Missing "${skuHeaderName}" header on sheet ${sh.getName()}`,
    );
  }

  const skuSet = new Set(skuList);
  let count = 0;

  for (let r = 1; r < data.length; r++) {
    const sku = String(data[r][idxSku] || "").trim();
    if (sku && !skuSet.has(sku)) count++;
  }

  return count;
}

/**
 * Ensure a sheet has rows for every SKU in skuList.
 * - Keeps existing rows (preserves any text you typed)
 * - Appends missing SKUs
 * - Optionally removes SKUs not in skuList
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sh
 * @param {string[]} skuList
 * @param {object} opts
 * @param {string} opts.skuHeaderName - header name for SKU column
 * @param {boolean} opts.removeOrphans - delete rows whose SKU no longer exists
 */
function syncSkuIndexSheet_(sh, skuList, opts) {
  const skuHeaderName = opts?.skuHeaderName || "sku";
  const removeOrphans = !!opts?.removeOrphans;

  const data = sh.getDataRange().getValues();
  if (data.length < 1)
    throw new Error(`Sheet ${sh.getName()} has no header row`);

  const headers = data[0].map((h) => String(h).trim());
  const idxSku = headers.indexOf(skuHeaderName);
  if (idxSku === -1)
    throw new Error(
      `Missing "${skuHeaderName}" header on sheet ${sh.getName()}`,
    );

  // Build existing map sku -> rowIndex (1-based row in sheet)
  const existingSkuToRow = new Map();
  for (let r = 1; r < data.length; r++) {
    const sku = String(data[r][idxSku] || "").trim();
    if (sku && !existingSkuToRow.has(sku)) existingSkuToRow.set(sku, r + 1);
  }

  const skuSet = new Set(skuList);

  // Append missing SKUs
  const missing = skuList.filter((sku) => !existingSkuToRow.has(sku));
  if (missing.length) {
    const startRow = sh.getLastRow() + 1;
    const rows = missing.map((sku) => {
      const row = new Array(headers.length).fill("");
      row[idxSku] = sku;
      return row;
    });
    sh.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  }

  // Optionally remove orphans (rows whose SKU no longer exists)
  if (removeOrphans && data.length > 1) {
    // delete bottom-up to avoid index shifting
    for (let r = data.length - 1; r >= 1; r--) {
      const sku = String(data[r][idxSku] || "").trim();
      if (sku && !skuSet.has(sku)) sh.deleteRow(r + 1);
    }
  }
}

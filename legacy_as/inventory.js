function rebuildInventoryIndex() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const names = getSheetNames();

  const shIndex = ss.getSheetByName(names.inventorySheetName);
  const shP = ss.getSheetByName(names.productsSheetName);
  const shV = ss.getSheetByName(names.variantsSheetName);

  if (!shIndex || !shP || !shV) {
    throw new Error("Missing one of: inventory_index, products, variants");
  }

  const findCol = (sh, headerName) => {
    const header = sh
      .getRange(1, 1, 1, sh.getLastColumn())
      .getValues()[0]
      .map((h) => String(h).trim().toLowerCase());
    const idx = header.indexOf(String(headerName).toLowerCase());
    if (idx === -1) {
      throw new Error(`No "${headerName}" header found on ${sh.getName()}`);
    }
    return idx + 1;
  };

  // 1) Sync inventory_index rows to the master SKU list
  const skus = collectAllSkus_();
  syncSkuIndexSheet_(shIndex, skus, {
    skuHeaderName: "sku",
    removeOrphans: false,
  });

  // 2) Fill inventory_index.product_name based on SKU match (products first, then variants)
  const idxSkuCol = findCol(shIndex, "sku");
  const idxNameCol = findCol(shIndex, "product_name");

  const pSkuCol = findCol(shP, "sku");
  const pDisplayNameCol = findCol(shP, "display_name");
  const pNameCol = findCol(shP, "product_name");

  const vSkuCol = findCol(shV, "sku");
  const vReadableNameCol = findCol(shV, "readable_name");
  const vNameCol = findCol(shV, "product_name");

  // Build sku -> product_name map (products win over variants)
  const skuToName = new Map();

  const pLastRow = shP.getLastRow();
  if (pLastRow >= 2) {
    const pSkuVals = shP.getRange(2, pSkuCol, pLastRow - 1, 1).getValues();
    const pDisplayVals = shP
      .getRange(2, pDisplayNameCol, pLastRow - 1, 1)
      .getValues();
    const pNameVals = shP.getRange(2, pNameCol, pLastRow - 1, 1).getValues();

    for (let i = 0; i < pSkuVals.length; i++) {
      const sku = String(pSkuVals[i][0] || "").trim();
      const displayName = String(pDisplayVals[i][0] || "").trim();
      const productName = String(pNameVals[i][0] || "").trim();
      const name = displayName || productName;

      if (sku && name) skuToName.set(sku, name);
    }
  }

  const vLastRow = shV.getLastRow();
  if (vLastRow >= 2) {
    const vSkuVals = shV.getRange(2, vSkuCol, vLastRow - 1, 1).getValues();
    const vReadableVals = shV
      .getRange(2, vReadableNameCol, vLastRow - 1, 1)
      .getValues();
    const vNameVals = shV.getRange(2, vNameCol, vLastRow - 1, 1).getValues();

    for (let i = 0; i < vSkuVals.length; i++) {
      const sku = String(vSkuVals[i][0] || "").trim();
      const readableName = String(vReadableVals[i][0] || "").trim();
      const productName = String(vNameVals[i][0] || "").trim();
      const name = readableName || productName;

      if (sku && name && !skuToName.has(sku)) skuToName.set(sku, name);
    }
  }

  // Read inventory_index sku + product_name, write names for blanks only
  const finalLastRow = shIndex.getLastRow();
  if (finalLastRow < 2) return;

  const skuRange = shIndex
    .getRange(2, idxSkuCol, finalLastRow - 1, 1)
    .getValues();
  const nameRange = shIndex
    .getRange(2, idxNameCol, finalLastRow - 1, 1)
    .getValues();

  let changed = false;
  const outNames = nameRange.map((r, i) => {
    const existingName = String(r[0] || "").trim();
    if (existingName) return [r[0]];
    const sku = String(skuRange[i][0] || "").trim();
    const newName = skuToName.get(sku) || "";
    if (newName) changed = true;
    return [newName];
  });

  if (changed) {
    shIndex.getRange(2, idxNameCol, outNames.length, 1).setValues(outNames);
  }
}

function refreshInventoryIndexWooStock() {
  const woo = getWooConfig();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("inventory_index");
  if (!sh) throw new Error('Missing sheet "inventory_index"');

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return { ok: true, updated: 0 };

  const headers = data[0].map((h) => String(h).trim());
  const col = (name) => {
    const i = headers.indexOf(name);
    if (i === -1)
      throw new Error(`Missing column "${name}" on inventory_index`);
    return i;
  };

  const idxSku = col("sku");
  const idxWooStock = col("woo_stock");
  const idxLastSyncAt = headers.includes("last_sync_at")
    ? col("last_sync_at")
    : -1;

  const skus = data.slice(1).map((r) => String(r[idxSku] || "").trim());
  const skuMeta = buildInventorySkuMeta_();

  // Group known variant SKUs by their parent product SKU. Product SKUs can now
  // share the same CHR- prefix pattern, so we must use sheet structure rather
  // than SKU shape to decide whether a row is a product or a variation.
  const variationSkuByParent = {};
  const simpleSkuList = [];

  skus.forEach((sku) => {
    if (!sku) return;

    const meta = skuMeta.get(sku);
    if (meta && meta.type === "variant" && meta.parentSku) {
      const parentSkuRoot = meta.parentSku;
      if (!variationSkuByParent[parentSkuRoot])
        variationSkuByParent[parentSkuRoot] = [];
      variationSkuByParent[parentSkuRoot].push(sku);
    } else {
      simpleSkuList.push(sku);
    }
  });

  // 1) Resolve parentSkuRoot -> Woo product ID
  const parentSkuRoots = Object.keys(variationSkuByParent);
  const parentSkuRootToProductId = {};

  parentSkuRoots.forEach((parentSkuRoot) => {
    const url =
      `${woo.storeUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(parentSkuRoot)}` +
      `&consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const arr = JSON.parse(resp.getContentText() || "[]");
    if (Array.isArray(arr) && arr[0] && arr[0].id) {
      parentSkuRootToProductId[parentSkuRoot] = arr[0].id;
    }
  });

  // 2) For each parent product, fetch ALL variations once, build sku -> qty map
  const variationQtyBySku = {};

  Object.keys(parentSkuRootToProductId).forEach((parentSkuRoot) => {
    const productId = parentSkuRootToProductId[parentSkuRoot];
    const skuQtyMap = fetchAllWooVariationStockQtyBySku_(woo, productId);
    Object.keys(skuQtyMap).forEach(
      (sku) => (variationQtyBySku[sku] = skuQtyMap[sku]),
    );
  });

  // 3) For simple SKUs, try products?sku=...
  const simpleQtyBySku = {};
  simpleSkuList.forEach((sku) => {
    const url =
      `${woo.storeUrl}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}` +
      `&consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const arr = JSON.parse(resp.getContentText() || "[]");
    if (Array.isArray(arr) && arr[0]) {
      // stock_quantity is null sometimes; treat null as blank
      const qty = arr[0].stock_quantity;
      simpleQtyBySku[sku] = qty === null || qty === undefined ? "" : qty;
    }
  });

  // 4) Write back woo_stock (+ last_sync_at)
  const outWooStock = data.slice(1).map((row) => {
    const sku = String(row[idxSku] || "").trim();
    if (!sku) return [row[idxWooStock] || ""];
    if (sku in variationQtyBySku) return [variationQtyBySku[sku]];
    if (sku in simpleQtyBySku) return [simpleQtyBySku[sku]];
    return [row[idxWooStock] || ""];
  });

  sh.getRange(2, idxWooStock + 1, outWooStock.length, 1).setValues(outWooStock);

  if (idxLastSyncAt >= 0) {
    const now = new Date();
    const syncVals = outWooStock.map(() => [now]);
    sh.getRange(2, idxLastSyncAt + 1, syncVals.length, 1).setValues(syncVals);
  }

  return { ok: true, updated: outWooStock.length };
}

// Helper: 1 product -> map of sku => stock_quantity (paged)
function fetchAllWooVariationStockQtyBySku_(woo, productId) {
  const map = {};
  let page = 1;

  while (true) {
    const url =
      `${woo.storeUrl}/wp-json/wc/v3/products/${productId}/variations` +
      `?per_page=100&page=${page}` +
      `&consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) break;

    const arr = JSON.parse(resp.getContentText() || "[]");
    if (!Array.isArray(arr) || arr.length === 0) break;

    arr.forEach((v) => {
      if (!v || !v.sku) return;
      map[String(v.sku).trim()] =
        v.stock_quantity === null ? "" : v.stock_quantity;
    });

    if (arr.length < 100) break;
    page += 1;
  }

  return map;
}

function buildInventorySkuMeta_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const names = getSheetNames();
  const shProducts = ss.getSheetByName(names.productsSheetName);
  const shVariants = ss.getSheetByName(names.variantsSheetName);

  if (!shProducts || !shVariants) {
    throw new Error("Missing products or variants sheet");
  }

  const productData = shProducts.getDataRange().getValues();
  const variantData = shVariants.getDataRange().getValues();
  const meta = new Map();

  if (productData.length >= 1) {
    const productHeaders = productData[0].map((h) => String(h).trim());
    const idxProductSku = productHeaders.indexOf("sku");
    if (idxProductSku === -1) {
      throw new Error('Missing column "sku" on products');
    }

    productData.slice(1).forEach((row) => {
      const sku = String(row[idxProductSku] || "").trim();
      if (!sku) return;
      meta.set(sku, { type: "product", parentSku: sku });
    });
  }

  if (variantData.length >= 1) {
    const variantHeaders = variantData[0].map((h) => String(h).trim());
    const idxVariantSku = variantHeaders.indexOf("sku");
    const idxProductId = variantHeaders.indexOf("product_id");
    if (idxVariantSku === -1 || idxProductId === -1) {
      throw new Error('Missing "sku" or "product_id" column on variants');
    }

    variantData.slice(1).forEach((row) => {
      const sku = String(row[idxVariantSku] || "").trim();
      const productId = String(row[idxProductId] || "").trim();
      if (!sku || !productId) return;
      const parentSku = `CHR-${productId}`;
      meta.set(sku, { type: "variant", parentSku });
    });
  }

  return meta;
}

function buildProductsFromSheet() {
  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();

  const productsSheet = ss.getSheetByName(names.productsSheetName);
  const variantsSheet = ss.getSheetByName(names.variantsSheetName);
  const categorySheet = ss.getSheetByName(names.categorySheetName);
  const subcategorySheet = ss.getSheetByName(names.subcategorySheetName);

  if (!productsSheet || !variantsSheet) {
    throw new Error(
      "Missing products or variants sheet. Check sheet names in Script Properties.",
    );
  }
  if (!categorySheet || !subcategorySheet) {
    throw new Error(
      "Missing category or subcategory sheet. Check CATEGORY_SHEET_NAME and SUBCATEGORY_SHEET_NAME in Script Properties.",
    );
  }

  const productData = productsSheet.getDataRange().getValues();
  const variantData = variantsSheet.getDataRange().getValues();
  const categoryData = categorySheet.getDataRange().getValues();
  const subcategoryData = subcategorySheet.getDataRange().getValues();

  if (productData.length < 2) return [];

  const productHeaders = productData[0].map((h) => String(h).trim());
  const variantHeaders = variantData[0].map((h) => String(h).trim());
  const categoryHeaders = categoryData[0].map((h) => String(h).trim());
  const subcategoryHeaders = subcategoryData[0].map((h) => String(h).trim());

  const colIndex = (headers, name) => {
    const i = headers.indexOf(name);
    if (i === -1) throw new Error(`Missing expected column "${name}"`);
    return i;
  };

  // --- Category map from "category" tab ---
  // category | cat_code | cat_id
  const cIdx = {
    category: colIndex(categoryHeaders, "category"),
    catCode: colIndex(categoryHeaders, "cat_code"),
    catId: colIndex(categoryHeaders, "cat_id"),
  };
  // --- Category map from "subcategory" tab ---
  // subcategory | subcat_code | subcat_id
  const scIdx = {
    subCat: colIndex(subcategoryHeaders, "subcategory"),
    subCatCode: colIndex(subcategoryHeaders, "subcat_code"),
    subCatId: colIndex(subcategoryHeaders, "subcat_id"),
  };

  const catCodeToId = {};
  const subCatCodeToId = {};

  for (let r = 1; r < categoryData.length; r++) {
    const row = categoryData[r];

    const catCodeCell = row[cIdx.catCode];
    const catIdCell = row[cIdx.catId];

    if (catCodeCell && catIdCell) {
      const catCode = String(catCodeCell).trim();
      if (catCode) catCodeToId[catCode] = Number(catIdCell);
    }
  }

  for (let r = 1; r < subcategoryData.length; r++) {
    const row = subcategoryData[r];

    const subCatCodeCell = row[scIdx.subCatCode];
    const subCatIdCell = row[scIdx.subCatId];

    if (subCatCodeCell && subCatIdCell) {
      const subCode = String(subCatCodeCell).trim();
      if (subCode) subCatCodeToId[subCode] = Number(subCatIdCell);
    }
  }

  // --- Products sheet columns ---
  const pIdx = {
    product_id: colIndex(productHeaders, "product_id"),
    woo_id: colIndex(productHeaders, "woo_id"),
    readable_name: colIndex(productHeaders, "readable_name"),
    product_name: colIndex(productHeaders, "product_name"),
    display_name: colIndex(productHeaders, "display_name"),
    design: colIndex(productHeaders, "design"),
    style: colIndex(productHeaders, "style_modifier"),
    base_price: colIndex(productHeaders, "base_price_dollars"),
    category: colIndex(productHeaders, "category"),
    category_code: colIndex(productHeaders, "category_code"),
    subcategory: colIndex(productHeaders, "subcategory"),
    subcat_code: colIndex(productHeaders, "subcategory_code"),
    primary_image: colIndex(productHeaders, "primary_image"),
    description: colIndex(productHeaders, "primary_description"),
    short_description: colIndex(productHeaders, "short_description"),
    stock_qty: colIndex(productHeaders, "stock_qty"),
    weight_oz: colIndex(productHeaders, "weight_oz"),
    dim_w: colIndex(productHeaders, "dimensions_width"),
    dim_h: colIndex(productHeaders, "dimensions_height"),
    dim_d: colIndex(productHeaders, "dimensions_depth"),
    sku: colIndex(productHeaders, "sku"),
  };

  // --- Variants sheet columns ---
  const vIdx = {
    product_id: colIndex(variantHeaders, "product_id"),
    variant_id: colIndex(variantHeaders, "variant_id"),
    woo_variant_id: colIndex(variantHeaders, "woo_variant_id"),
    sku: colIndex(variantHeaders, "sku"),
    product_name: colIndex(variantHeaders, "product_name"),
    color: colIndex(variantHeaders, "color"),
    design: colIndex(variantHeaders, "design"),
    design_variant: colIndex(variantHeaders, "design_variant"),
    size: colIndex(variantHeaders, "size"),
    dimensions: colIndex(variantHeaders, "dimensions"), // kept (optional use later)
    price_dollars: colIndex(variantHeaders, "price_dollars"),
    stock_qty: colIndex(variantHeaders, "stock_qty"),
    image_variant: colIndex(variantHeaders, "image_variant"),
    description_variant: colIndex(variantHeaders, "description_variant"),
    weight_oz_variant: colIndex(variantHeaders, "weight_oz_variant"),
  };

  const productsById = {};

  // --- Build base product objects from products sheet ---
  for (let r = 1; r < productData.length; r++) {
    const row = productData[r];
    const productIdCell = row[pIdx.product_id];
    if (!productIdCell) continue;
    const productId = String(productIdCell).trim();
    if (!productId) continue;

    const wooIdCell = pIdx.woo_id >= 0 ? row[pIdx.woo_id] : "";
    const wooId =
      wooIdCell === "" || wooIdCell == null ? "" : String(wooIdCell).trim();

    const skuCell = row[pIdx.sku];
    const sku = String(skuCell).trim();

    const displayNameCell = row[pIdx.display_name];
    const productNameCell = row[pIdx.product_name];
    const readableNameCell = row[pIdx.readable_name];

    const displayName = displayNameCell ? String(displayNameCell).trim() : "";
    const productName = productNameCell ? String(productNameCell).trim() : "";
    const readableName = readableNameCell
      ? String(readableNameCell).trim()
      : "";

    const categoryCodeCell = row[pIdx.category_code];
    const subcatCodeCell = row[pIdx.subcat_code];
    const primaryImageCell = row[pIdx.primary_image];
    const rawDescriptionCell = row[pIdx.description];
    const shortDescriptionCell = row[pIdx.short_description];

    const categoryCode = categoryCodeCell
      ? String(categoryCodeCell).trim()
      : "";
    const subcatCode = subcatCodeCell ? String(subcatCodeCell).trim() : "";
    const isSticker = subcatCode === "STK";

    const basePrice = normalizePriceCell(row[pIdx.base_price]);

    // stock for simple products
    const stockCell = row[pIdx.stock_qty];
    const productStockQty =
      stockCell === "" || stockCell == null ? 0 : parseInt(stockCell, 10) || 0;

    const primaryImage = primaryImageCell
      ? String(primaryImageCell).trim()
      : "";
    const rawDescription = rawDescriptionCell
      ? String(rawDescriptionCell).trim()
      : "";
    const short_description = shortDescriptionCell
      ? String(shortDescriptionCell).trim()
      : "";

    const name = displayName || productName || readableName || productId;

    // categories
    const categories = [];
    if (categoryCode && catCodeToId[categoryCode])
      categories.push({ id: catCodeToId[categoryCode] });
    if (subcatCode && subCatCodeToId[subcatCode])
      categories.push({ id: subCatCodeToId[subcatCode] });

    const chrMerchId = catCodeToId["CHR"];
    if (chrMerchId && !categories.some((c) => c.id === chrMerchId))
      categories.push({ id: chrMerchId });

    // 🔹 product-level shipping defaults
    const productWeight = normalizeWeight(row[pIdx.weight_oz]);
    const shipping_width = normalizeDimCell(row[pIdx.dim_w]);
    const shipping_height = normalizeDimCell(row[pIdx.dim_h]);
    let shipping_depth = normalizeDimCell(row[pIdx.dim_d]);

    // Default depth only for flat sticker products that have 2D dimensions
    if (isSticker && shipping_width && shipping_height && !shipping_depth) {
      shipping_depth = "0.01";
    }

    const images = [];
    if (primaryImage) images.push({ src: primaryImage.trim() });

    productsById[productId] = {
      productId,
      wooId,
      sku,
      skuRoot: `CHR-${productId}`,
      name,
      description: rawDescription,
      short_description,
      isSticker,
      regular_price: basePrice,
      stock_quantity: productStockQty,
      categories,
      images,

      // 🔹 NEW: defaults inherited by variations
      weight: productWeight,
      shipping_width,
      shipping_height,
      shipping_depth,

      _attrValues: {
        Color: new Set(),
        Size: new Set(),
        Design: new Set(),
      },
      variations: [],
    };
  }

  // --- Attach variants & build attribute values dynamically ---
  for (let r = 1; r < variantData.length; r++) {
    const row = variantData[r];
    const productIdCell = row[vIdx.product_id];
    if (!productIdCell) continue;

    const productId = String(productIdCell).trim();
    if (!productId) continue;

    const product = productsById[productId];
    if (!product) continue;

    const wooVariantIdCell = row[vIdx.woo_variant_id];
    const wooVariantId =
      wooVariantIdCell === "" || wooVariantIdCell == null
        ? ""
        : String(wooVariantIdCell).trim();

    const skuCell = row[vIdx.sku];
    if (!skuCell) continue;
    const sku = String(skuCell).trim();
    if (!sku) continue;

    const colorCell = row[vIdx.color];
    const sizeCell = row[vIdx.size];
    const designCell = row[vIdx.design];
    const designVariantCell = row[vIdx.design_variant];
    const descriptionCell = row[vIdx.description_variant];

    const color = colorCell ? String(colorCell).trim() : "";
    const size = sizeCell ? String(sizeCell).trim() : "";
    const design = designCell ? String(designCell).trim() : "";
    const designVariant = designVariantCell
      ? String(designVariantCell).trim()
      : "";
    const descriptionRaw = descriptionCell ? String(descriptionCell) : "";
    const description = formatText(descriptionRaw);

    const price = normalizePriceCell(row[vIdx.price_dollars]);

    const stockRaw = row[vIdx.stock_qty];
    const stockQty =
      stockRaw === "" || stockRaw == null ? 0 : parseInt(stockRaw, 10) || 0;

    const attrs = [];

    // For stickers, don't expose Color as a selectable attribute
    if (!product.isSticker && color) {
      product._attrValues.Color.add(color);
      attrs.push({ name: "Color", option: color });
    }

    // For stickers, don't expose Size as an attribute (they're separate products per dimension)
    if (!product.isSticker && size && size !== "no size") {
      product._attrValues.Size.add(size);
      attrs.push({ name: "Size", option: size });
    }

    // 🔹 Design attribute (combined)
    let designLabel = "";
    if (design && designVariant) designLabel = `${design} – ${designVariant}`;
    else if (design) designLabel = design;
    else if (designVariant) designLabel = designVariant;

    if (designLabel) {
      product._attrValues.Design.add(designLabel);
      attrs.push({ name: "Design", option: designLabel });
    }

    // 🔹 Variation weight: allow override, else inherit from product
    const variantWeight =
      normalizeWeight(row[vIdx.weight_oz_variant]) || product.weight || "";

    // 🔹 Variation dimensions: inherit from product-level width/height/depth (shipping fields)
    // Woo expects length/width/height. We'll map:
    // length = depth (or height if you prefer), width = width, height = height
    // (sticker envelopes are basically flat; depth can be 0.01 etc)
    const v_length = product.shipping_depth || "";
    const v_width = product.shipping_width || "";
    const v_height = product.shipping_height || "";

    product.variations.push({
      productId,
      sku,
      wooVariantId,
      regular_price: price,
      stock_quantity: stockQty,
      description: description,
      attributes: attrs,

      // 🔹 shipping meta for Woo variation payload
      weight: variantWeight,
      length: v_length,
      width: v_width,
      height: v_height,
    });
  }

  // --- Finalize attribute definitions per product ---
  const result = [];

  Object.keys(productsById).forEach((productId) => {
    const p = productsById[productId];

    const attributes = [];
    const attrOrder = p.isSticker ? ["Design"] : ["Color", "Size", "Design"];

    attrOrder.forEach((attrName) => {
      const set = p._attrValues[attrName];
      if (set && set.size > 0) {
        attributes.push({
          name: attrName,
          variation: true,
          options: Array.from(set),
        });
      }
    });

    delete p._attrValues;

    p.attributes = attributes;
    result.push(p);
  });

  return result;
}

function syncSingleProductObjectToWoo(woo, product, flags) {
  const pushStock = !!(flags && flags.pushStock);
  const parentSku = product.sku;
  const includeImage = false;

  const hasVariants =
    Array.isArray(product.variations) && product.variations.length > 0;

  const parentData = {
    name: product.name,
    sku: product.sku, // ✅ SKU can change; Woo will update it on PUT
    type: "variable",
    description: formatText(product.description || ""),
    short_description: formatText(product.short_description || ""),
    categories: product.categories || [],
    attributes: product.attributes || [],
    status: "publish",
    weight: product.weight || "",
    dimensions: {
      length: product.shipping_depth || "",
      width: product.shipping_width || "",
      height: product.shipping_height || "",
    },
  };

  if (hasVariants) {
    parentData.type = "variable";
    parentData.manage_stock = false;

    if (pushStock) {
      const anyInStock = (product.variations || []).some(
        (v) => (parseInt(v.stock_quantity, 10) || 0) > 0,
      );
      parentData.stock_status = anyInStock ? "instock" : "outofstock";
      parentData.backorders = "no";
    }
  } else {
    parentData.type = "simple";
    parentData.regular_price = product.regular_price || "";

    if (pushStock) {
      const qty = parseInt(product.stock_quantity, 10) || 0;
      parentData.manage_stock = true;
      parentData.stock_quantity = qty;
      parentData.stock_status = qty > 0 ? "instock" : "outofstock";
      parentData.backorders = "no";
    }
  }

  if (includeImage && product.images && product.images.length) {
    parentData.images = product.images;
  }

  // ✅ NEW: resolve Woo product ID
  let productId = product.wooId ? Number(product.wooId) : 0;

  // If no woo_id yet, try one-time SKU lookup (migration/backfill)
  if (!productId) {
    const lookupUrl =
      `${woo.storeUrl}/wp-json/wc/v3/products` +
      `?sku=${encodeURIComponent(parentSku)}` +
      `&consumer_key=${woo.consumerKey}` +
      `&consumer_secret=${woo.consumerSecret}`;

    const lookupResp = UrlFetchApp.fetch(lookupUrl, {
      muteHttpExceptions: true,
    });
    const existing = JSON.parse(lookupResp.getContentText() || "[]");
    if (Array.isArray(existing) && existing[0] && existing[0].id) {
      productId = existing[0].id;

      // ✅ write back woo_id so future syncs never depend on SKU lookup
      writeWooIdToProductsSheet_(product.productId, productId);
      product.wooId = String(productId);
    }
  }

  // ✅ Update or create using productId if we have it
  if (productId) {
    const updateUrl =
      `${woo.storeUrl}/wp-json/wc/v3/products/${productId}` +
      `?consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

    const resp = UrlFetchApp.fetch(updateUrl, {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(parentData),
      muteHttpExceptions: true,
    });

    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(
        `Woo product update failed for woo_id=${productId} HTTP ${code}: ${resp
          .getContentText()
          .slice(0, 300)}`,
      );
    }
  } else {
    // create
    const createUrl =
      `${woo.storeUrl}/wp-json/wc/v3/products` +
      `?consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

    const createdResp = UrlFetchApp.fetch(createUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(parentData),
      muteHttpExceptions: true,
    });

    const created = JSON.parse(createdResp.getContentText() || "{}");
    productId = created.id;

    if (!productId) {
      throw new Error(
        `Failed to create Woo product for sku=${parentSku}: ${createdResp
          .getContentText()
          .slice(0, 300)}`,
      );
    }

    // ✅ write Woo ID back to products sheet
    writeWooIdToProductsSheet_(product.productId, productId);
    product.wooId = String(productId);
  }

  // ✅ sync variations under stable parent woo_id
  if (hasVariants) {
    syncWooVariationsForProduct(woo, productId, product.variations, flags);
  }
}

function syncProductToShopById(targetProductId) {
  const woo = getWooConfig();
  const flags = getSyncFlags();
  logBoth(`Sync flags: pushStock=${flags.pushStock}`);
  const products = buildProductsFromSheet();

  const product = products.find((p) => p.productId === targetProductId);
  if (!product)
    throw new Error(`No product found with productId "${targetProductId}"`);

  // Hard-stop if any variable product has ambiguous/duplicate attribute combos
  assertNoVariationAttributeCollisions([product], {
    hardStop: true,
    logFn: logBoth,
    notifyEmail: true,
  });
  syncSingleProductObjectToWoo(woo, product, flags);
}

function syncProductsToShopWithOptions(opts) {
  const pushStock = !!(opts && opts.pushStock);
  const woo = getWooConfig();
  const flags = getSyncFlags(pushStock);

  logBoth(`Sync flags: pushStock=${flags.pushStock}`);

  const products = buildProductsFromSheet();

  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();
  const productsSheet = ss.getSheetByName(names.productsSheetName);

  const data = productsSheet.getDataRange().getValues();
  const headers = data[0].map((h) => String(h).trim());

  const col = (name) => {
    const idx = headers.indexOf(name);
    if (idx === -1)
      throw new Error(`Missing column "${name}" on products sheet`);
    return idx;
  };

  const idxProductId = col("product_id");
  const idxLastHash = col("last_hash");
  const idxLastSyncedAt = col("last_synced_at");

  const rowByProductId = {};
  for (let r = 1; r < data.length; r++) {
    const pid = String(data[r][idxProductId] || "").trim();
    if (pid) rowByProductId[pid] = r;
  }

  const updates = [];

  products.forEach((p) => {
    const rowIndex = rowByProductId[p.productId];
    if (rowIndex == null) return;

    const newHash = computeProductSyncHash(p);
    const oldHash = String(data[rowIndex][idxLastHash] || "").trim();

    if (oldHash && oldHash === newHash) {
      logBoth(`⏭️ Skip unchanged: ${p.productId}`);
      return;
    }

    syncSingleProductObjectToWoo(woo, p, flags);

    updates.push({ rowIndex, hash: newHash, timestamp: new Date() });
  });

  const numRows = data.length - 1;
  if (numRows > 0 && updates.length > 0) {
    logBoth(`Writing sync metadata for ${updates.length} changed product(s).`);
    writeProductSyncAuditRows_(
      productsSheet,
      updates,
      idxLastHash + 1,
      idxLastSyncedAt + 1,
    );
    logBoth("Finished writing sync metadata.");
  }

  logBoth(`Bulk sync complete. Synced ${updates.length} product(s).`);
}

function syncProductsToShop() {
  const woo = getWooConfig();
  const flags = getSyncFlags();
  logBoth(`Sync flags: pushStock=${flags.pushStock}`);

  const products = buildProductsFromSheet();

  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();
  const productsSheet = ss.getSheetByName(names.productsSheetName);

  const data = productsSheet.getDataRange().getValues();
  const headers = data[0].map((h) => String(h).trim());

  const col = (name) => {
    const idx = headers.indexOf(name);
    if (idx === -1)
      throw new Error(`Missing column "${name}" on products sheet`);
    return idx;
  };

  const idxProductId = col("product_id");
  const idxLastHash = col("last_hash");
  const idxLastSyncedAt = col("last_synced_at");

  // Map product_id -> row index in sheet (0-based in data)
  const rowByProductId = {};
  for (let r = 1; r < data.length; r++) {
    const pid = String(data[r][idxProductId] || "").trim();
    if (pid) rowByProductId[pid] = r;
  }

  logBoth(`Starting bulk sync for ${products.length} products`);

  const updates = []; // { rowIndex, hash, timestamp }

  products.forEach((p) => {
    const rowIndex = rowByProductId[p.productId];
    if (rowIndex == null) {
      logBoth(
        `⚠️ No row found on products sheet for productId=${p.productId} (skipping)`,
      );
      return;
    }

    const newHash = computeProductSyncHash(p);
    const oldHash = String(data[rowIndex][idxLastHash] || "").trim();

    if (oldHash && oldHash === newHash) {
      logBoth(`⏭️ Skip unchanged: ${p.productId}`);
      return;
    }

    logBoth(`--- Syncing productId=${p.productId}, sku=${p.sku} ---`);

    try {
      syncSingleProductObjectToWoo(woo, p, flags);
    } catch (e) {
      logBoth(
        `❌ Sync failed for ${p.productId}: ${e && e.message ? e.message : e}`,
      );
      if (e && e.stack) logBoth(e.stack);
      return;
    }

    updates.push({
      rowIndex,
      hash: newHash,
      timestamp: new Date(),
    });
  });

  // Build 2 column arrays for rows 2..last
  const numRows = data.length - 1;
  if (numRows > 0 && updates.length > 0) {
    logBoth(`Writing sync metadata for ${updates.length} changed product(s).`);
    writeProductSyncAuditRows_(
      productsSheet,
      updates,
      idxLastHash + 1,
      idxLastSyncedAt + 1,
    );
    logBoth("Finished writing sync metadata.");
  }

  logBoth(
    `Bulk sync complete. Synced ${updates.length} product(s), skipped ${
      products.length - updates.length
    }.`,
  );
}

function syncInventoryStockOnlyToShop(changes) {
  const woo = getWooConfig();
  const flags = getSyncFlags(true);
  logBoth("Starting stock-only sync");

  const changeMap = buildInventoryStockChangeMap_(changes);
  if (!changeMap.size) {
    logBoth("No stock changes found for stock-only sync.");
    return { ok: true, updated: 0, synced: false };
  }

  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();
  const productsSheet = ss.getSheetByName(names.productsSheetName);
  const variantsSheet = ss.getSheetByName(names.variantsSheetName);
  if (!productsSheet || !variantsSheet) {
    throw new Error("Missing products or variants sheet");
  }

  const productsData = productsSheet.getDataRange().getValues();
  const variantsData = variantsSheet.getDataRange().getValues();

  if (productsData.length < 2) {
    throw new Error("Products sheet has no data rows");
  }

  const catalog = buildStockOnlyCatalogSnapshot_(productsData, variantsData);
  const targetsByProductId = new Map();

  changeMap.forEach((qty, sku) => {
    const variantMeta = catalog.variantBySku.get(sku);
    if (variantMeta) {
      const productId = variantMeta.productId;
      if (!targetsByProductId.has(productId)) {
        targetsByProductId.set(productId, {
          productId,
          targetVariationSkus: new Set(),
        });
      }
      targetsByProductId.get(productId).targetVariationSkus.add(sku);
      return;
    }

    const productMeta = catalog.productBySku.get(sku);
    if (!productMeta) return;

    if (catalog.productHasVariants.has(productMeta.productId)) {
      logBoth(
        `⚠️ Stock-only sync skipped parent SKU ${sku}; variable products are synced by variation SKU.`,
      );
      return;
    }

    targetsByProductId.set(productMeta.productId, {
      productId: productMeta.productId,
      targetVariationSkus: new Set(),
    });
  });

  if (!targetsByProductId.size) {
    logBoth("No matching products or variations found for stock-only sync.");
    return { ok: true, updated: 0, synced: false };
  }

  const idxLastHash = catalog.pIdx.lastHash;
  const idxLastSyncedAt = catalog.pIdx.lastSyncedAt;

  const updates = [];
  targetsByProductId.forEach(({ productId, targetVariationSkus }) => {
    const snapshot = buildStockOnlyProductSnapshot_(
      catalog,
      productId,
      changeMap,
    );
    if (!snapshot) return;

    logBoth(
      `--- Stock-only sync productId=${snapshot.product.productId}, sku=${snapshot.product.sku} ---`,
    );

    syncSingleProductStockOnlyToWoo(
      woo,
      snapshot.product,
      flags,
      targetVariationSkus,
    );

    updates.push({
      rowIndex: snapshot.rowIndex,
      hash: computeStockOnlySyncHash_(snapshot.product),
      timestamp: new Date(),
    });
  });

  if (updates.length > 0) {
    logBoth(
      `Writing sync metadata for ${updates.length} stock-only changed product(s).`,
    );
    writeProductSyncAuditRows_(
      productsSheet,
      updates,
      idxLastHash + 1,
      idxLastSyncedAt + 1,
    );
    logBoth("Finished writing sync metadata.");
  }

  logBoth(`Stock-only sync complete. Synced ${updates.length} product(s).`);

  return {
    ok: true,
    updated: updates.length,
    synced: true,
    updatedSkus: Array.from(changeMap.keys()),
  };
}

function buildStockOnlyCatalogSnapshot_(productsData, variantsData) {
  const productHeaders = productsData[0].map((h) => String(h).trim());
  const variantHeaders = variantsData[0].map((h) => String(h).trim());

  const colIndex = (headers, name) => {
    const i = headers.indexOf(name);
    if (i === -1) throw new Error(`Missing expected column "${name}"`);
    return i;
  };

  const pIdx = {
    product_id: colIndex(productHeaders, "product_id"),
    woo_id: colIndex(productHeaders, "woo_id"),
    stock_qty: colIndex(productHeaders, "stock_qty"),
    sku: colIndex(productHeaders, "sku"),
    lastHash: colIndex(productHeaders, "last_hash"),
    lastSyncedAt: colIndex(productHeaders, "last_synced_at"),
  };

  const vIdx = {
    product_id: colIndex(variantHeaders, "product_id"),
    woo_variant_id: colIndex(variantHeaders, "woo_variant_id"),
    sku: colIndex(variantHeaders, "sku"),
    stock_qty: colIndex(variantHeaders, "stock_qty"),
  };

  const productById = new Map();
  const productBySku = new Map();
  const variantBySku = new Map();
  const variantsByProductId = new Map();
  const productHasVariants = new Set();

  for (let r = 1; r < productsData.length; r++) {
    const row = productsData[r];
    const productId = String(row[pIdx.product_id] || "").trim();
    if (!productId) continue;
    const sku = String(row[pIdx.sku] || "").trim();
    const wooId =
      row[pIdx.woo_id] === "" || row[pIdx.woo_id] == null
        ? ""
        : String(row[pIdx.woo_id]).trim();

    const record = {
      rowIndex: r,
      row,
      productId,
      sku,
      wooId,
      hasVariants: false,
    };
    productById.set(productId, record);
    if (sku) productBySku.set(sku, record);
  }

  for (let r = 1; r < variantsData.length; r++) {
    const row = variantsData[r];
    const productId = String(row[vIdx.product_id] || "").trim();
    if (!productId) continue;
    const sku = String(row[vIdx.sku] || "").trim();
    if (!sku) continue;
    const wooVariantId =
      row[vIdx.woo_variant_id] === "" || row[vIdx.woo_variant_id] == null
        ? ""
        : String(row[vIdx.woo_variant_id]).trim();

    const record = { rowIndex: r, row, productId, sku, wooVariantId };
    variantBySku.set(sku, record);
    if (!variantsByProductId.has(productId)) {
      variantsByProductId.set(productId, []);
    }
    variantsByProductId.get(productId).push(record);
    productHasVariants.add(productId);
  }

  productById.forEach((record, productId) => {
    record.hasVariants = productHasVariants.has(productId);
  });

  return {
    pIdx,
    vIdx,
    productById,
    productBySku,
    variantBySku,
    variantsByProductId,
    productHasVariants,
  };
}

function buildStockOnlyProductSnapshot_(catalog, productId, changeMap) {
  const productMeta = catalog.productById.get(productId);
  if (!productMeta) return null;

  const row = productMeta.row;
  const pIdx = catalog.pIdx;
  const vIdx = catalog.vIdx;

  const wooIdCell = row[pIdx.woo_id];
  const wooId =
    wooIdCell === "" || wooIdCell == null ? "" : String(wooIdCell).trim();

  const skuCell = row[pIdx.sku];
  const sku = String(skuCell).trim();

  const stockCell = row[pIdx.stock_qty];
  const productStockQty =
    stockCell === "" || stockCell == null ? 0 : parseInt(stockCell, 10) || 0;

  const product = {
    productId,
    wooId,
    sku,
    skuRoot: `CHR-${productId}`,
    stock_quantity: productStockQty,
    hasVariants: productMeta.hasVariants,
    variations: [],
  };

  const variantRecords = catalog.variantsByProductId.get(productId) || [];
  variantRecords.forEach((variantMeta) => {
    const vRow = variantMeta.row;
    const variantSkuCell = vRow[vIdx.sku];
    const variantSku = variantSkuCell ? String(variantSkuCell).trim() : "";
    if (!variantSku) return;

    const stockRaw = vRow[vIdx.stock_qty];
    const stockQty =
      stockRaw === "" || stockRaw == null ? 0 : parseInt(stockRaw, 10) || 0;
    const stockQtyOverride = changeMap.has(variantSku)
      ? changeMap.get(variantSku)
      : stockQty;

    product.variations.push({
      productId,
      sku: variantSku,
      wooVariantId: variantMeta.wooVariantId,
      stock_quantity: stockQtyOverride,
    });
  });

  return {
    rowIndex: productMeta.rowIndex,
    product,
  };
}

function computeStockOnlySyncHash_(product) {
  return hashObject({
    productId: product.productId,
    sku: product.sku,
    hasVariants: !!product.hasVariants,
    stock_quantity: parseInt(product.stock_quantity, 10) || 0,
    variations: (product.variations || [])
      .map((v) => ({
        sku: v.sku,
        stock_quantity: parseInt(v.stock_quantity, 10) || 0,
      }))
      .sort((a, b) => a.sku.localeCompare(b.sku)),
  });
}

function fetchAllWooVariationsIndex_(woo, productId) {
  const out = { skuToId: {}, sigToId: {} };
  let page = 1;

  while (true) {
    const url =
      `${woo.storeUrl}/wp-json/wc/v3/products/${productId}/variations` +
      `?per_page=100&page=${page}` +
      `&consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    const body = resp.getContentText() || "[]";

    if (code < 200 || code >= 300) {
      throw new Error(
        `Failed to list variations for product ${productId}. HTTP ${code}: ${body.slice(
          0,
          300,
        )}`,
      );
    }

    const arr = JSON.parse(body);
    if (!Array.isArray(arr) || arr.length === 0) break;

    arr.forEach((v) => {
      if (!v || !v.id) return;

      const sku = v.sku ? String(v.sku).trim() : "";
      if (sku) out.skuToId[sku] = v.id;

      const sig = variationSignature_(v.attributes || []);
      if (sig) out.sigToId[sig] = v.id;
    });

    if (arr.length < 100) break;
    page += 1;
  }

  return out;
}

function syncWooVariationsForProduct(woo, productId, variations, flags) {
  const pushStock = !!(flags && flags.pushStock);

  // 1 GET per product per page
  const skuToVarId = fetchAllWooVariationsBySku(woo, productId);

  variations.forEach((variation) => {
    const sku = String(variation.sku || "").trim();
    if (!sku) return;

    // ✅ prefer stored Woo variation id
    let existingId = variation.wooVariantId
      ? Number(variation.wooVariantId)
      : 0;

    // ✅ fallback: match by SKU
    if (!existingId) existingId = skuToVarId[sku] || 0;

    let variationUrl, method;
    if (existingId) {
      variationUrl =
        `${woo.storeUrl}/wp-json/wc/v3/products/${productId}/variations/${existingId}` +
        `?consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;
      method = "put";
    } else {
      variationUrl =
        `${woo.storeUrl}/wp-json/wc/v3/products/${productId}/variations` +
        `?consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;
      method = "post";
    }

    const payload = {
      sku,
      regular_price: variation.regular_price,
      description: formatText(variation.description || ""),
      attributes: variation.attributes,
      weight: variation.weight || "",
      dimensions: {
        length: variation.length || "",
        width: variation.width || "",
        height: variation.height || "",
      },
    };

    if (pushStock) {
      const qty = parseInt(variation.stock_quantity, 10) || 0;
      payload.manage_stock = true;
      payload.stock_quantity = qty;
      payload.stock_status = qty > 0 ? "instock" : "outofstock";
      payload.backorders = "no";
    }

    const resp = UrlFetchApp.fetch(variationUrl, {
      method,
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = resp.getResponseCode();
    const body = resp.getContentText() || "";

    if (code < 200 || code >= 300) {
      logBoth(
        `❌ Variation sync failed SKU=${sku} HTTP ${code}: ${body.slice(
          0,
          300,
        )}`,
      );
      throw new Error(`Variation sync failed SKU=${sku} HTTP ${code}`);
    }

    // ✅ capture ID and write back if needed
    let returnedId = existingId;
    try {
      const parsed = JSON.parse(body || "{}");
      if (parsed && parsed.id) returnedId = parsed.id;
    } catch (e) {}

    if (
      returnedId &&
      String(variation.wooVariantId || "").trim() !== String(returnedId)
    ) {
      variation.wooVariantId = String(returnedId);
      writeWooVariantIdToVariantsSheet_(variation.productId, sku, returnedId);
    }
  });
}

function writeWooIdToProductsSheet_(productId, wooId) {
  if (!productId || !wooId) return;

  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();
  const sh = ss.getSheetByName(names.productsSheetName);
  if (!sh) throw new Error("Missing products sheet");

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0].map((h) => String(h).trim());
  const idxPid = headers.indexOf("product_id");
  const idxWoo = headers.indexOf("woo_id");

  if (idxPid === -1)
    throw new Error('Missing column "product_id" on products sheet');
  if (idxWoo === -1)
    throw new Error('Missing column "woo_id" on products sheet');

  const targetPid = String(productId).trim();
  for (let r = 1; r < data.length; r++) {
    const pid = String(data[r][idxPid] || "").trim();
    if (pid === targetPid) {
      // only write if blank or different (avoid extra edits)
      const existing = String(data[r][idxWoo] || "").trim();
      if (existing !== String(wooId)) {
        sh.getRange(r + 1, idxWoo + 1).setValue(String(wooId));
      }
      return;
    }
  }
}
function writeWooVariantIdToVariantsSheet_(productId, sku, wooVarId) {
  if (!productId || !sku || !wooVarId) return;

  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();
  const sh = ss.getSheetByName(names.variantsSheetName);
  if (!sh) throw new Error("Missing variants sheet");

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  const headers = data[0].map((h) => String(h).trim());
  const idxPid = headers.indexOf("product_id");
  const idxSku = headers.indexOf("sku");
  const idxWoo = headers.indexOf("woo_variant_id");

  if (idxPid === -1)
    throw new Error('Missing column "product_id" on variants sheet');
  if (idxSku === -1) throw new Error('Missing column "sku" on variants sheet');
  if (idxWoo === -1)
    throw new Error('Missing column "woo_variant_id" on variants sheet');

  const targetPid = String(productId).trim();
  const targetSku = String(sku).trim();

  for (let r = 1; r < data.length; r++) {
    const pid = String(data[r][idxPid] || "").trim();
    const s = String(data[r][idxSku] || "").trim();
    if (pid === targetPid && s === targetSku) {
      const existing = String(data[r][idxWoo] || "").trim();
      if (existing !== String(wooVarId)) {
        sh.getRange(r + 1, idxWoo + 1).setValue(String(wooVarId));
      }
      return;
    }
  }
}

function fetchAllWooVariationsBySku(woo, productId) {
  const map = {};
  let page = 1;

  while (true) {
    const url =
      `${woo.storeUrl}/wp-json/wc/v3/products/${productId}/variations` +
      `?per_page=100&page=${page}` +
      `&consumer_key=${woo.consumerKey}` +
      `&consumer_secret=${woo.consumerSecret}`;

    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const code = resp.getResponseCode();
    const body = resp.getContentText() || "[]";

    if (code < 200 || code >= 300) {
      throw new Error(
        `Failed to list variations for product ${productId}. HTTP ${code}: ${body.slice(
          0,
          300,
        )}`,
      );
    }

    const arr = JSON.parse(body);
    if (!Array.isArray(arr) || arr.length === 0) break;

    arr.forEach((v) => {
      if (v && v.sku) {
        map[String(v.sku).trim()] = v.id;
      }
    });

    if (arr.length < 100) break; // last page
    page += 1;
  }

  return map;
}

function buildInventoryStockChangeMap_(changes) {
  const map = new Map();

  if (Array.isArray(changes) && changes.length > 0) {
    changes.forEach((item) => {
      if (!item) return;
      const sku = String(item.sku || "").trim();
      if (!sku) return;

      const qtyRaw = item.stock_qty;
      if (qtyRaw === "" || qtyRaw == null) {
        map.set(sku, "");
        return;
      }

      const qty = Number(qtyRaw);
      map.set(
        sku,
        Number.isFinite(qty) ? Math.round(qty) : String(qtyRaw).trim(),
      );
    });
    return map;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("inventory_index");
  if (!sh) throw new Error('Missing sheet "inventory_index"');

  const data = sh.getDataRange().getValues();
  if (data.length < 2) return map;

  const headers = data[0].map((h) => String(h).trim());
  const col = (name) => {
    const idx = headers.indexOf(name);
    if (idx === -1)
      throw new Error(`Missing column "${name}" on inventory_index`);
    return idx;
  };

  const idxSku = col("sku");
  const idxStockQty = col("stock_qty");
  const idxWooStock = col("woo_stock");

  for (let r = 1; r < data.length; r++) {
    const sku = String(data[r][idxSku] || "").trim();
    if (!sku) continue;

    const stockQty = data[r][idxStockQty];
    if (stockQty === "" || stockQty == null) continue;

    const wooStock = data[r][idxWooStock];
    if (String(stockQty).trim() === String(wooStock).trim()) continue;

    const qty = Number(stockQty);
    map.set(
      sku,
      Number.isFinite(qty) ? Math.round(qty) : String(stockQty).trim(),
    );
  }

  return map;
}

function syncSingleProductStockOnlyToWoo(
  woo,
  product,
  flags,
  targetVariationSkus,
) {
  const pushStock = !!(flags && flags.pushStock);
  const parentSku = product.sku;
  const hasVariants =
    Array.isArray(product.variations) && product.variations.length > 0;

  let productId = product.wooId ? Number(product.wooId) : 0;
  if (!productId) {
    const lookupUrl =
      `${woo.storeUrl}/wp-json/wc/v3/products` +
      `?sku=${encodeURIComponent(parentSku)}` +
      `&consumer_key=${woo.consumerKey}` +
      `&consumer_secret=${woo.consumerSecret}`;

    const lookupResp = UrlFetchApp.fetch(lookupUrl, {
      muteHttpExceptions: true,
    });
    const existing = JSON.parse(lookupResp.getContentText() || "[]");
    if (Array.isArray(existing) && existing[0] && existing[0].id) {
      productId = existing[0].id;
      writeWooIdToProductsSheet_(product.productId, productId);
      product.wooId = String(productId);
    }
  }

  if (!productId) {
    logBoth(
      `⚠️ Missing Woo product ID for stock-only sync: ${parentSku} (skipping)`,
    );
    return;
  }

  const parentUrl =
    `${woo.storeUrl}/wp-json/wc/v3/products/${productId}` +
    `?consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

  if (hasVariants) {
    if (pushStock) {
      const anyInStock = (product.variations || []).some(
        (v) => (parseInt(v.stock_quantity, 10) || 0) > 0,
      );
      const parentPayload = {
        manage_stock: false,
        stock_status: anyInStock ? "instock" : "outofstock",
        backorders: "no",
      };

      const parentResp = UrlFetchApp.fetch(parentUrl, {
        method: "put",
        contentType: "application/json",
        payload: JSON.stringify(parentPayload),
        muteHttpExceptions: true,
      });

      const parentCode = parentResp.getResponseCode();
      if (parentCode < 200 || parentCode >= 300) {
        throw new Error(
          `Woo parent stock update failed for woo_id=${productId} HTTP ${parentCode}: ${parentResp
            .getContentText()
            .slice(0, 300)}`,
        );
      }
    }

    syncWooVariationsStockOnlyForProduct(
      woo,
      productId,
      product.variations || [],
      targetVariationSkus,
    );
    return;
  }

  if (!pushStock) return;

  const qty = parseInt(product.stock_quantity, 10) || 0;
  const parentPayload = {
    manage_stock: true,
    stock_quantity: qty,
    stock_status: qty > 0 ? "instock" : "outofstock",
    backorders: "no",
  };

  const parentResp = UrlFetchApp.fetch(parentUrl, {
    method: "put",
    contentType: "application/json",
    payload: JSON.stringify(parentPayload),
    muteHttpExceptions: true,
  });

  const parentCode = parentResp.getResponseCode();
  if (parentCode < 200 || parentCode >= 300) {
    throw new Error(
      `Woo stock update failed for woo_id=${productId} HTTP ${parentCode}: ${parentResp
        .getContentText()
        .slice(0, 300)}`,
    );
  }
}

function syncWooVariationsStockOnlyForProduct(
  woo,
  productId,
  variations,
  targetVariationSkus,
) {
  const hasTargets =
    targetVariationSkus && typeof targetVariationSkus.has === "function";
  const targetSetSize = hasTargets ? targetVariationSkus.size : 0;
  let skuToVarId = {};
  const needsSkuLookup = variations.some((variation) => {
    const sku = String(variation.sku || "").trim();
    if (!sku) return false;
    if (hasTargets && targetSetSize > 0 && !targetVariationSkus.has(sku)) {
      return false;
    }
    return !String(variation.wooVariantId || "").trim();
  });

  if (needsSkuLookup) {
    skuToVarId = fetchAllWooVariationsBySku(woo, productId);
  }

  variations.forEach((variation) => {
    const sku = String(variation.sku || "").trim();
    if (!sku) return;
    if (hasTargets && targetSetSize > 0 && !targetVariationSkus.has(sku)) {
      return;
    }

    let existingId = variation.wooVariantId
      ? Number(variation.wooVariantId)
      : 0;
    if (!existingId) existingId = skuToVarId[sku] || 0;

    if (!existingId) {
      logBoth(
        `⚠️ Missing Woo variation ID for stock-only sync: product ${productId}, sku ${sku} (skipping)`,
      );
      return;
    }

    const qty = parseInt(variation.stock_quantity, 10) || 0;
    const payload = {
      manage_stock: true,
      stock_quantity: qty,
      stock_status: qty > 0 ? "instock" : "outofstock",
      backorders: "no",
    };

    const variationUrl =
      `${woo.storeUrl}/wp-json/wc/v3/products/${productId}/variations/${existingId}` +
      `?consumer_key=${woo.consumerKey}&consumer_secret=${woo.consumerSecret}`;

    const resp = UrlFetchApp.fetch(variationUrl, {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      throw new Error(
        `Woo variation stock update failed SKU=${sku} HTTP ${code}: ${resp
          .getContentText()
          .slice(0, 300)}`,
      );
    }
  });
}

function writeProductSyncAuditRows_(
  productsSheet,
  updates,
  lastHashCol,
  lastSyncedAtCol,
) {
  const seenRows = new Set();
  const uniqueUpdates = updates.filter((u) => {
    const key = String(u.rowIndex);
    if (seenRows.has(key)) return false;
    seenRows.add(key);
    return true;
  });

  const areAdjacent = Math.abs(lastHashCol - lastSyncedAtCol) === 1;

  uniqueUpdates.forEach((u) => {
    const sheetRow = u.rowIndex + 1;

    if (areAdjacent) {
      const startCol = Math.min(lastHashCol, lastSyncedAtCol);
      const values =
        startCol === lastHashCol
          ? [[u.hash, u.timestamp]]
          : [[u.timestamp, u.hash]];
      productsSheet.getRange(sheetRow, startCol, 1, 2).setValues(values);
      return;
    }

    productsSheet.getRange(sheetRow, lastHashCol, 1, 1).setValue(u.hash);
    productsSheet
      .getRange(sheetRow, lastSyncedAtCol, 1, 1)
      .setValue(u.timestamp);
  });
}

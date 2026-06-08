function doGet(e) {
  const action = getRequestedAction_(e);
  if (action) {
    try {
      return handleInventoryGetAction_(action);
    } catch (err) {
      return jsonResponse_({
        ok: false,
        action,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  const page =
    e && e.parameter && e.parameter.page
      ? String(e.parameter.page)
      : "inventory";

  if (page === "inventory" || page === "stock") {
    return renderInventoryManagerHtml_();
  }

  return renderInventoryManagerHtml_();
}

function getRequestedAction_(e) {
  const action =
    e && e.parameter && e.parameter.action ? String(e.parameter.action) : "";
  return action.trim();
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function handleInventoryGetAction_(action) {
  if (action === "check_access") {
    const access = checkInventoryManagerAccessForUi_();
    return jsonResponse_({ ok: true, action, access });
  }

  if (action === "get_woo_stock") {
    const access = checkInventoryManagerAccessForUi_();
    rebuildInventoryIndex();
    refreshInventoryIndexWooStock();
    return jsonResponse_({
      ok: true,
      action,
      access,
      refreshed: true,
    });
  }

  if (action === "get_inventory_manager_data" || action === "inventory_data") {
    const access = checkInventoryManagerAccessForUi_();
    rebuildInventoryIndex();
    refreshInventoryIndexWooStock();
    return jsonResponse_({
      ok: true,
      action,
      access,
      data: buildInventoryManagerData_(access),
    });
  }

  throw new Error(`unknown_action:${action}`);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function renderInventoryManagerHtml_() {
  return HtmlService.createTemplateFromFile("inventoryManager")
    .evaluate()
    .setTitle("CHR Inventory Manager")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getInventoryManagerData() {
  const access = checkInventoryManagerAccessForUi_();
  rebuildInventoryIndex();
  refreshInventoryIndexWooStock();

  return buildInventoryManagerData_(access);
}

function checkInventoryManagerAccessForUi_() {
  const access = userAccessInfo_();
  if (!access || access.role === "none") {
    throw new Error("ACCESS_DENIED");
  }

  return access;
}

function checkInventoryManagerAccessForUi() {
  return checkInventoryManagerAccessForUi_();
}

function ensureInventoryIndexForUi() {
  rebuildInventoryIndex();
  return { ok: true };
}

function refreshInventoryWooStockForUi() {
  return refreshInventoryIndexWooStock();
}

function getInventoryManagerViewData(access) {
  const resolvedAccess = access && access.role ? access : checkInventoryManagerAccessForUi_();
  return buildInventoryManagerData_(resolvedAccess);
}

function syncInventoryManagerStock(changes) {
  const normalizedChanges = Array.isArray(changes) ? changes : [];
  if (!normalizedChanges.length) {
    return { ok: true, updated: 0, synced: false };
  }

  const changeMap = new Map();
  normalizedChanges.forEach((item) => {
    if (!item) return;
    const sku = String(item.sku || "").trim();
    if (!sku) return;

    const qtyRaw = item.stock_qty;
    if (qtyRaw === "" || qtyRaw == null) {
      changeMap.set(sku, "");
      return;
    }

    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty < 0) {
      throw new Error(`Invalid stock_qty for SKU ${sku}`);
    }

    changeMap.set(sku, Math.round(qty));
  });

  if (!changeMap.size) {
    return { ok: true, updated: 0, synced: false };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(getSheetNames().inventorySheetName);
  if (!sh) throw new Error('Missing sheet "inventory_index"');

  const data = sh.getDataRange().getValues();
  if (data.length < 2) {
    throw new Error('Sheet "inventory_index" has no inventory rows');
  }

  const headers = data[0].map((h) => String(h).trim());
  const col = (name) => {
    const idx = headers.indexOf(name);
    if (idx === -1)
      throw new Error(`Missing column "${name}" on inventory_index`);
    return idx;
  };

  const idxSku = col("sku");
  const idxStockQty = col("stock_qty");

  const outStock = data.slice(1).map((row) => [row[idxStockQty]]);
  const updatedSkus = [];
  const foundSkus = new Set();

  for (let r = 1; r < data.length; r++) {
    const sku = String(data[r][idxSku] || "").trim();
    if (!sku || !changeMap.has(sku)) continue;
    outStock[r - 1][0] = changeMap.get(sku);
    updatedSkus.push(sku);
    foundSkus.add(sku);
  }

  const missingSkus = Array.from(changeMap.keys()).filter(
    (sku) => !foundSkus.has(sku),
  );
  if (missingSkus.length) {
    throw new Error(
      `Missing inventory_index rows for: ${missingSkus.join(", ")}`,
    );
  }

  sh.getRange(2, idxStockQty + 1, outStock.length, 1).setValues(outStock);

  return syncInventoryStockOnlyToShop(normalizedChanges);
}

function buildInventoryManagerData_(access) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const names = getSheetNames();

  const shProducts = ss.getSheetByName(names.productsSheetName);
  const shVariants = ss.getSheetByName(names.variantsSheetName);
  const shInventory = ss.getSheetByName(names.inventorySheetName);

  if (!shProducts || !shVariants || !shInventory) {
    throw new Error("Missing products, variants, or inventory_index sheet");
  }

  const productsData = shProducts.getDataRange().getValues();
  const variantsData = shVariants.getDataRange().getValues();
  const inventoryData = shInventory.getDataRange().getValues();

  if (!productsData.length || !variantsData.length || !inventoryData.length) {
    throw new Error("One or more required sheets are empty");
  }

  const colIndex_ = (headers, name, sheetName) => {
    const idx = headers.indexOf(name);
    if (idx === -1) throw new Error(`Missing column "${name}" on ${sheetName}`);
    return idx;
  };

  const productHeaders = productsData[0].map((h) => String(h).trim());
  const variantHeaders = variantsData[0].map((h) => String(h).trim());
  const inventoryHeaders = inventoryData[0].map((h) => String(h).trim());

  const pIdx = {
    productId: colIndex_(productHeaders, "product_id", shProducts.getName()),
    sku: colIndex_(productHeaders, "sku", shProducts.getName()),
    displayName: colIndex_(
      productHeaders,
      "display_name",
      shProducts.getName(),
    ),
    productName: colIndex_(
      productHeaders,
      "product_name",
      shProducts.getName(),
    ),
    readableName: colIndex_(
      productHeaders,
      "readable_name",
      shProducts.getName(),
    ),
  };

  const vIdx = {
    productId: colIndex_(variantHeaders, "product_id", shVariants.getName()),
    sku: colIndex_(variantHeaders, "sku", shVariants.getName()),
    variantDetails: colIndex_(
      variantHeaders,
      "variant_details",
      shVariants.getName(),
    ),
    readableName: colIndex_(
      variantHeaders,
      "readable_name",
      shVariants.getName(),
    ),
  };

  const iIdx = {
    sku: colIndex_(inventoryHeaders, "sku", shInventory.getName()),
    productName: colIndex_(
      inventoryHeaders,
      "product_name",
      shInventory.getName(),
    ),
    stockQty: colIndex_(inventoryHeaders, "stock_qty", shInventory.getName()),
    wooStock: colIndex_(inventoryHeaders, "woo_stock", shInventory.getName()),
    lastSyncAt: inventoryHeaders.includes("last_sync_at")
      ? colIndex_(inventoryHeaders, "last_sync_at", shInventory.getName())
      : -1,
  };

  const inventoryBySku = new Map();
  inventoryData.slice(1).forEach((row) => {
    const sku = String(row[iIdx.sku] || "").trim();
    if (!sku) return;
    inventoryBySku.set(sku, {
      sku,
      productName: String(row[iIdx.productName] || "").trim(),
      stockQty: normalizeInventoryQty_(row[iIdx.stockQty]),
      wooStock: normalizeInventoryQty_(row[iIdx.wooStock]),
      lastSyncAt:
        iIdx.lastSyncAt >= 0 && row[iIdx.lastSyncAt]
          ? String(row[iIdx.lastSyncAt])
          : "",
    });
  });

  const variantsByProductId = new Map();
  variantsData.slice(1).forEach((row) => {
    const productId = String(row[vIdx.productId] || "").trim();
    const sku = String(row[vIdx.sku] || "").trim();
    if (!productId || !sku) return;

    const variant = {
      sku,
      label:
        String(row[vIdx.variantDetails] || "").trim() ||
        String(row[vIdx.readableName] || "").trim() ||
        sku,
    };

    if (!variantsByProductId.has(productId)) {
      variantsByProductId.set(productId, []);
    }
    variantsByProductId.get(productId).push(variant);
  });

  const groups = [];
  const usedSkus = new Set();
  let totalRows = 0;
  let totalUnsynced = 0;
  const conflictGroups = [];

  productsData.slice(1).forEach((row) => {
    const productId = String(row[pIdx.productId] || "").trim();
    const productSku = String(row[pIdx.sku] || "").trim();
    if (!productId || !productSku) return;

    const displayName =
      String(row[pIdx.displayName] || "").trim() ||
      String(row[pIdx.productName] || "").trim() ||
      String(row[pIdx.readableName] || "").trim() ||
      productSku;

    const variantDefs = variantsByProductId.get(productId) || [];
    const rowsForGroup = [];
    if (variantDefs.length) {
      // Variable products keep a parent SKU in inventory_index, but stock lives on
      // the child variation SKUs, so the parent row should not render in the editor.
      if (inventoryBySku.has(productSku)) {
        usedSkus.add(productSku);
      }

      variantDefs.forEach((variant) => {
        const inv = inventoryBySku.get(variant.sku);
        rowsForGroup.push({
          sku: variant.sku,
          label: variant.label,
          stockQty: inv ? inv.stockQty : "",
          wooStock: inv ? inv.wooStock : "",
          lastSyncAt: inv ? inv.lastSyncAt : "",
          rowType: "variant",
        });
        usedSkus.add(variant.sku);
      });
    } else {
      const inv = inventoryBySku.get(productSku);
      rowsForGroup.push({
        sku: productSku,
        label: "Main product",
        stockQty: inv ? inv.stockQty : "",
        wooStock: inv ? inv.wooStock : "",
        lastSyncAt: inv ? inv.lastSyncAt : "",
        rowType: "product",
      });
      usedSkus.add(productSku);
    }

    totalRows += rowsForGroup.length;
    const conflictCount = rowsForGroup.filter(
      (item) => item.stockQty !== item.wooStock,
    ).length;
    totalUnsynced += conflictCount;

    groups.push({
      productId,
      productSku,
      displayName,
      rowCount: rowsForGroup.length,
      rows: rowsForGroup,
    });

    if (conflictCount > 0) {
      conflictGroups.push({
        productId,
        displayName,
        count: conflictCount,
      });
    }
  });

  const orphanRows = [];
  inventoryBySku.forEach((inv, sku) => {
    if (usedSkus.has(sku)) return;
    orphanRows.push({
      sku,
      label: inv.productName || "Unmapped SKU",
      stockQty: inv.stockQty,
      wooStock: inv.wooStock,
      lastSyncAt: inv.lastSyncAt,
    });
  });

  if (orphanRows.length) {
    totalRows += orphanRows.length;
    const orphanConflictCount = orphanRows.filter(
      (item) => item.stockQty !== item.wooStock,
    ).length;
    totalUnsynced += orphanConflictCount;
    groups.push({
      productId: "unassigned",
      productSku: "unassigned",
      displayName: "Unassigned SKUs",
      rowCount: orphanRows.length,
      rows: orphanRows,
      isOrphanGroup: true,
    });

    if (orphanConflictCount > 0) {
      conflictGroups.push({
        productId: "unassigned",
        displayName: "Unassigned SKUs",
        count: orphanConflictCount,
      });
    }
  }

  return {
    ok: true,
    userEmail: access.email,
    role: access.role,
    canEdit: access.canEdit,
    generatedAt: new Date().toISOString(),
    summary: {
      productCount: groups.filter((group) => !group.isOrphanGroup).length,
      groupCount: groups.length,
      rowCount: totalRows,
      unsyncedCount: totalUnsynced,
      conflictGroups,
    },
    groups,
  };
}

function normalizeInventoryQty_(value) {
  if (value === "" || value == null) return "";
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  return String(value).trim();
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();

  ui.createMenu("CHR Merch Admin")
    .addItem("Sync Products (NO stock)", "menuSyncProductsNoStock_")
    .addItem("Sync Products + Stock", "menuSyncProductsWithStock_")
    .addItem("Sync Only Stock", "menuPushOnlyStock_")
    .addSeparator()
    .addItem(
      "Refresh inventory_index woo_stock",
      "menuRefreshInventoryIndexWooStock_",
    )
    .addToUi();

  ui.createMenu("CHR Dev Tools")
    .addItem("Populate descriptions SKUs", "populateDescriptionsSkus")
    .addItem("Populate inventory_index SKUs", "menuRebuildInventoryIndex_")
    .addToUi();
}

function menuSyncProductsNoStock_() {
  runMenuActionWithAlert_("Sync Products (NO stock)", () =>
    syncProductsToShopWithOptions({ pushStock: false }),
  );
}
function menuSyncProductsWithStock_() {
  runMenuActionWithAlert_("Sync Products + Stock", () =>
    syncProductsToShopWithOptions({ pushStock: true }),
  );
}

function menuPushOnlyStock_() {
  runMenuActionWithAlert_("Sync Only Stock", () =>
    syncInventoryStockOnlyToShop(),
  );
}

function menuRefreshInventoryIndexWooStock_() {
  runMenuActionWithAlert_("Refresh inventory_index woo_stock", () =>
    refreshInventoryIndexWooStock(),
  );
}

function menuRebuildInventoryIndex_() {
  runMenuActionWithAlert_("Populate inventory_index SKUs", () =>
    rebuildInventoryIndex(),
  );
}

function runMenuActionWithAlert_(label, fn) {
  const ui = SpreadsheetApp.getUi();
  const startedAt = Date.now();

  try {
    const result = fn();
    const elapsedMs = Date.now() - startedAt;
    const elapsedLabel = formatElapsedMs_(elapsedMs);

    if (result && result.synced === true) {
      ui.alert(
        `${label} complete. Synced ${result.updated || 0} item(s) in ${elapsedLabel}.`,
      );
      return;
    }

    if (result && result.ok === true && typeof result.updated === "number") {
      ui.alert(
        `${label} complete. Updated ${result.updated} row(s) in ${elapsedLabel}.`,
      );
      return;
    }

    ui.alert(`${label} complete in ${elapsedLabel}.`);
  } catch (err) {
    ui.alert(
      `${label} failed: ${err && err.message ? err.message : String(err)}`,
    );
  }
}

function formatElapsedMs_(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function doPost(e) {
  try {
    const body =
      e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const payload = JSON.parse(body);

    // Optional shared secret check (recommended)
    const expected =
      PropertiesService.getScriptProperties().getProperty("APPSHEET_SECRET") ||
      "";
    if (expected) {
      const got = String(payload.secret || "");
      if (got !== expected) {
        return ContentService.createTextOutput(
          JSON.stringify({ ok: false, error: "forbidden" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    const action = String(payload.action || "");

    if (action === "backfill_taxonomy_ids") {
      const result = backfillWooCategoryAndSubcategoryIds();
      return ContentService.createTextOutput(
        JSON.stringify(result),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "push_stock") {
      const result = syncInventoryStockOnlyToShop();
      return ContentService.createTextOutput(
        JSON.stringify(result),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "sync_products") {
      const result = syncProductsToShopWithOptions({ pushStock: false });
      return ContentService.createTextOutput(
        JSON.stringify(result),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "sync_products_with_stock") {
      const result = syncProductsToShopWithOptions({ pushStock: true });
      return ContentService.createTextOutput(
        JSON.stringify(result),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: "unknown_action" }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({
        ok: false,
        error: err && err.message ? err.message : String(err),
      }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

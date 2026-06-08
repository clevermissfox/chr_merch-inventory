/**
 * Public: Populate the descriptions sheet with all SKUs from products+variants.
 */
function populateDescriptionsSkus() {
  const ss = SpreadsheetApp.getActive();
  const names = getSheetNames();

  const sh = ss.getSheetByName(names.descriptionsSheetName);
  if (!sh) throw new Error('Missing sheet "descriptions"');

  const skus = collectAllSkus_();
  syncSkuIndexSheet_(sh, skus, { skuHeaderName: "sku", removeOrphans: false });

  SpreadsheetApp.getUi().alert(
    `Descriptions SKUs updated. Total SKUs: ${skus.length}`,
  );
}

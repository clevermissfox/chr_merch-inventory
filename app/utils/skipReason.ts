export interface SkipReasonFormatted {
  label: string;
  hint: string | null;
}

export function formatSkipReason(reason: string): SkipReasonFormatted {
  if (reason === "no_woo_id") {
    return {
      label: "Not yet published to site",
      hint: "Stock is saved to the sheet. Publish this product to WooCommerce to enable site sync.",
    };
  }
  if (reason === "draft_unpublished") {
    return {
      label: "Draft — not published to site",
      hint: "Stock is saved to the sheet. Publish this product to WooCommerce to enable site sync.",
    };
  }
  if (reason.toLowerCase().includes("missing woo parent product")) {
    return {
      label: "Not yet published to site",
      hint: "Stock is recorded in the sheet and will sync automatically once the product is published to WooCommerce.",
    };
  }
  if (reason === "variable_parent_not_editable") {
    return {
      label: "Variable product parent — update individual variants",
      hint: null,
    };
  }
  if (reason === "not_found") {
    return { label: "SKU not found in catalog", hint: null };
  }
  return { label: reason, hint: null };
}

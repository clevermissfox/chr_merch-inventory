export interface SkipReasonFormatted {
  label: string;
  hint: string | null;
  /** Label for the "review on Products page" link, matching this reason's tone. Null means no link should be shown. */
  cta: string | null;
}

export function formatSkipReason(reason: string): SkipReasonFormatted {
  // "Unpublished" = no wooId at all — nothing exists in WooCommerce yet.
  // draft_unpublished is kept as an alias for backward compatibility (older
  // clients/cached responses may still send it) but means the exact same
  // thing as no_woo_id: the sheet's published_status was never a reliable
  // signal here (this branch only fires when there's no wooId regardless of
  // what that field says), so there's no real "exists but hidden" case to
  // distinguish. A wooId'd draft product syncs its stock normally — this
  // skip only ever means "not created on WooCommerce yet."
  if (reason === "no_woo_id" || reason === "draft_unpublished") {
    return {
      label: "Unpublished",
      hint: "Stock is saved to the sheet. This product hasn't been created on WooCommerce yet — publish it from the Products page to enable site sync.",
      cta: "Review & publish on Products page →",
    };
  }
  if (reason.toLowerCase().includes("missing woo parent product")) {
    return {
      label: "Unpublished",
      hint: "Stock is recorded in the sheet and will sync automatically once the product is published to WooCommerce.",
      cta: "Review on Products page →",
    };
  }
  if (reason === "variable_parent_not_editable") {
    return {
      label: "Variable product parent — update individual variants",
      hint: null,
      cta: null,
    };
  }
  if (reason === "not_found") {
    return { label: "SKU not found in catalog", hint: null, cta: null };
  }
  return { label: reason, hint: null, cta: null };
}

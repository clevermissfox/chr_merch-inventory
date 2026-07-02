// Sale price must be strictly less than the regular price it's discounting
// from — WooCommerce's own REST API rejects sale_price >= regular_price
// server-side, so catching it at entry time avoids a confusing sync-time
// error surfacing far away from where the bad value was actually typed.
export function isSalePriceValid(
  regularPrice: string | null | undefined,
  salePrice: string | null | undefined,
): boolean {
  const sale = Number(salePrice);
  if (!salePrice || !Number.isFinite(sale)) return true; // no sale price set — nothing to validate
  const regular = Number(regularPrice);
  if (!regularPrice || !Number.isFinite(regular)) return true; // no regular price to compare against yet
  return sale < regular;
}

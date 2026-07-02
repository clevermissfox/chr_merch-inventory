function norm(v: string | null | undefined): string {
  return (v ?? "").toLowerCase().trim();
}

// Mirrors the variants-sheet SKU ARRAYFORMULA precedence: dimensions wins
// over size whenever both are set — size is only used as a fallback when
// dimensions is empty, never compared alongside it.
export function dimensionOrSizeKey(
  dimension: string | null | undefined,
  size: string | null | undefined,
): string {
  return norm(dimension) || norm(size);
}

export function variantDupeKey(v: {
  color?: string | null;
  designVariant?: string | null;
  dimension?: string | null;
  size?: string | null;
}): string {
  return [norm(v.color), norm(v.designVariant), dimensionOrSizeKey(v.dimension, v.size)].join(
    "|",
  );
}

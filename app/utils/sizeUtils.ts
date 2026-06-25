// Maps every common spelling/abbreviation of a size to its canonical sort rank.
// Canonical values (x-small, small, …) are included alongside all aliases so
// this map is the single source of truth for both sorting and conflict detection.
export const SIZE_ALIASES: Record<string, number> = {
  xxs: 0,
  xxsm: 0,
  xxsmall: 0,
  "xx-small": 0,
  "extra extra small": 1,
  "extra-extra-small": 1,
  "xtra xtra small": 1,
  xs: 1,
  xsm: 1,
  xsmall: 1,
  "x-small": 1,
  "extra small": 1,
  "extra-small": 1,
  "xtra small": 1,
  // small (rank 2)
  sm: 2,
  sml: 2,
  small: 2,
  // medium (rank 3)
  md: 3,
  med: 3,
  medium: 3,
  // large (rank 4)
  lg: 4,
  lrg: 4,
  large: 4,
  // x-large (rank 5)
  xl: 5,
  xlg: 5,
  xlarge: 5,
  "x-large": 5,
  "extra large": 5,
  "extra-large": 5,
  "xtra large": 5,
  // xx-large (rank 6)
  xxl: 6,
  "2xl": 6,
  xxlarge: 6,
  "xx-large": 6,
  "double xl": 6,
  "2x large": 6,
  "2x-large": 6,
  // xxx-large (rank 7)
  xxxl: 7,
  "3xl": 7,
  xxxlarge: 7,
  "xxx-large": 7,
  "triple xl": 7,
  "3x large": 7,
  "3x-large": 7,
  // one size (rank 8)
  os: 8,
  osfm: 8,
  osfa: 8,
  "one size": 8,
  onesize: 8,
  "one-size": 8,
  "one size fits all": 8,
  "one size fits most": 8,
  // no size (rank 9)
  ns: 9,
  nosize: 9,
  "no-size": 9,
  "no size": 9,
};

/**
 * Returns the sort rank for a size string (1 = x-small … 9 = no size).
 * Handles all known aliases. Unknown or empty values return 999 (sorts last).
 */
export function sizeRank(value: string | null | undefined): number {
  return SIZE_ALIASES[(value ?? "").trim().toLowerCase()] ?? 999;
}

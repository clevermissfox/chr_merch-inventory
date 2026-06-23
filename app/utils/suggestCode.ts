/**
 * Auto-suggests a short unique code from a human-readable value.
 *
 * Prefers 3 chars, then 4, then 2 as a last resort before declaring conflict.
 * Multi-word values try natural 4-char combos first, then fall back to 3→2.
 * Returns conflict:true when all attempts fail — caller must prompt user.
 */
export function suggestCode(
  value: string,
  existingCodes: string[],
): { code: string; conflict: boolean } {
  const upper = existingCodes.map((c) => c.toUpperCase());
  const words = value
    .toUpperCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Z]/g, ""))
    .filter(Boolean);
  const alpha = words.join("");

  // min 3 chars preferred; 2 only as last-resort fallback
  const ok = (candidate: string, minLen = 3) =>
    candidate.length >= minLen && !upper.includes(candidate) ? candidate : null;

  if (words.length === 0) return { code: "", conflict: true };

  if (words.length === 1) {
    // single word: 3 → 4 → 2 (last resort)
    const found =
      ok(alpha.slice(0, 3)) ??
      ok(alpha.slice(0, 4)) ??
      ok(alpha.slice(0, 2), 2);
    return found
      ? { code: found, conflict: false }
      : { code: alpha.slice(0, 4), conflict: true };
  }

  const w0 = words[0];
  const w1 = words[1];

  // multi-word: 4-char combos first, then 3-char, then 2-char last resort
  const found =
    ok(alpha.slice(0, 4)) ??
    ok((w0.slice(0, 3) + w1[0]).slice(0, 4)) ??
    ok((w0.slice(0, 2) + w1.slice(0, 2)).slice(0, 4)) ??
    ok(words.map((w) => w[0]).join("").slice(0, 4)) ??
    ok(alpha.slice(0, 3)) ??
    ok(alpha.slice(0, 2), 2);

  return found
    ? { code: found, conflict: false }
    : { code: alpha.slice(0, 4), conflict: true };
}

/**
 * Normalizes a Bangladeshi mobile number to E.164 (+8801XXXXXXXXX).
 * Accepts the common local and international spellings, with spaces, dashes,
 * dots or parentheses: 01712345678, 8801712345678, +880 1712-345678,
 * 00880 1712 345678. Returns null for anything that is not a valid BD mobile.
 */
export function normalizeBdPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s\-.()]/g, '');
  const match = /^(?:\+880|00880|880|0)?(1[3-9]\d{8})$/.exec(compact);
  if (!match?.[1]) {
    return null;
  }
  // A bare "1XXXXXXXXX" (no 0 or country code) is ambiguous; require a prefix.
  if (compact === match[1]) {
    return null;
  }
  return `+880${match[1]}`;
}

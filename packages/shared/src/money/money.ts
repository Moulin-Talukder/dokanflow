/**
 * Money is an integer number of poisha (1 taka = 100 poisha). These helpers convert
 * at the edges only, using string arithmetic so no float ever touches a price.
 */

/** Largest unit price the API accepts: ৳10,000,000.00. */
export const MAX_PRICE_POISHA = 1_000_000_000;

/**
 * Parses taka text such as "120", "120.5", "1,250.75" or "৳ 99.99" into poisha.
 * Returns null for anything else (negative, more than 2 decimals, garbage).
 */
export function parseTakaToPoisha(input: string): number | null {
  const cleaned = input.trim().replace(/^৳\s*/, '').replace(/,/g, '');
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const taka = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(2, '0'));
  const poisha = taka * 100 + fraction;
  return poisha <= MAX_PRICE_POISHA ? poisha : null;
}

/** Poisha as a plain decimal string, e.g. 12345 → "123.45", for form fields. */
export function poishaToTakaString(poisha: number): string {
  if (!Number.isSafeInteger(poisha)) throw new RangeError('poisha must be a safe integer');
  const sign = poisha < 0 ? '-' : '';
  const abs = Math.abs(poisha);
  return `${sign}${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

/** Display format with the taka sign and grouping, e.g. 123456 → "৳1,234.56". */
export function formatPoisha(poisha: number): string {
  const [whole = '0', fraction = '00'] = poishaToTakaString(Math.abs(poisha)).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${poisha < 0 ? '-' : ''}৳${grouped}.${fraction}`;
}

/**
 * Round half up for non-negative integers: floor((a + floor(b/2)) / b).
 * The single rounding rule in docs/SCHEMA.md; bigint so products cannot overflow.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new RangeError('roundHalfUp needs a non-negative numerator and positive denominator');
  }
  return (numerator + denominator / 2n) / denominator;
}

/** VAT rate in basis points from a percentage string: "7.5" → 750, "15" → 1500. */
export function parsePercentToBasisPoints(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, '').trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

/** Basis points as a percentage string: 750 → "7.5", 1500 → "15". */
export function basisPointsToPercent(bp: number): string {
  const whole = Math.floor(bp / 100);
  const fraction = String(bp % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${String(whole)}.${fraction}` : String(whole);
}

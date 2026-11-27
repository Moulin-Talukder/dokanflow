import { z } from 'zod';

/** Stock is stored in base units: pieces, grams or millilitres (docs/SCHEMA.md). */
export const productUnitSchema = z.enum(['piece', 'gram', 'ml']);
export type ProductUnit = z.infer<typeof productUnitSchema>;

/** Largest quantity in one movement or threshold: 1,000,000 kg/L or a billion pieces. */
export const MAX_QUANTITY = 1_000_000_000;

/**
 * How many base units make one display unit. Prices are per display unit
 * (per piece, per kg, per litre) and people count stock the same way.
 */
export const BASE_UNITS_PER_DISPLAY_UNIT: Readonly<Record<ProductUnit, number>> = {
  piece: 1,
  gram: 1000,
  ml: 1000,
};

/** Decimal places a quantity can have in display units (grams within a kg, etc.). */
const DISPLAY_DECIMALS: Readonly<Record<ProductUnit, number>> = { piece: 0, gram: 3, ml: 3 };

/**
 * Parses a display quantity ("2", "1.5", "0.25") into base units, exactly:
 * 1.5 kg → 1500 g. Pieces must be whole. `signed` allows a leading "-" (adjustments).
 * Returns null for anything invalid or out of range. Callers decide whether 0 is allowed.
 */
export function parseDisplayQuantity(
  input: string,
  unit: ProductUnit,
  options: { signed?: boolean } = {},
): number | null {
  const decimals = DISPLAY_DECIMALS[unit];
  const pattern = new RegExp(
    `^(${options.signed ? '[-+]?' : '\\+?'})(\\d{1,9})${decimals > 0 ? `(?:\\.(\\d{1,${String(decimals)}}))?` : ''}$`,
  );
  const match = pattern.exec(input.trim().replace(/,/g, ''));
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(decimals, '0') || '0');
  const base = whole * BASE_UNITS_PER_DISPLAY_UNIT[unit] + fraction;
  if (base > MAX_QUANTITY) return null;
  return sign * base;
}

/** Base units as a display number string: 1500 g → "1.5", 250 ml → "0.25", 12 pieces → "12". */
export function formatDisplayQuantity(baseUnits: number, unit: ProductUnit): string {
  const per = BASE_UNITS_PER_DISPLAY_UNIT[unit];
  const sign = baseUnits < 0 ? '-' : '';
  const abs = Math.abs(baseUnits);
  const whole = Math.floor(abs / per);
  if (per === 1) return `${sign}${String(whole)}`;
  const fraction = String(abs % per)
    .padStart(DISPLAY_DECIMALS[unit], '0')
    .replace(/0+$/, '');
  return `${sign}${String(whole)}${fraction ? `.${fraction}` : ''}`;
}

/** Unit suffixes accepted after a number, per product unit, and how many base units each is. */
const SUFFIXES: Readonly<Record<ProductUnit, Readonly<Record<string, 'display' | 'base'>>>> = {
  piece: { '': 'display', pc: 'display', pcs: 'display', piece: 'display', pieces: 'display' },
  gram: { '': 'display', kg: 'display', g: 'base', gm: 'base', gram: 'base', grams: 'base' },
  ml: { '': 'display', l: 'display', litre: 'display', liter: 'display', ml: 'base' },
};

/**
 * Parses what a cashier types into base units, with an optional unit suffix:
 * "1.5 kg" or "1.5" → 1500 g, "500 g" → 500 g, "0.5 L" → 500 ml, "250ml" → 250 ml,
 * "3" or "3 pcs" → 3 pieces. Base-unit suffixes (g, ml) take whole numbers only.
 * Returns null for anything else, including a suffix that does not fit the unit.
 */
export function parseQuantityWithUnit(input: string, unit: ProductUnit): number | null {
  const match = /^\+?([\d.,]+)\s*([a-z]*)$/.exec(input.trim().toLowerCase());
  if (!match?.[1]) return null;
  const kind = SUFFIXES[unit][match[2] ?? ''];
  if (kind === undefined) return null;
  if (kind === 'display') return parseDisplayQuantity(match[1], unit);
  const digits = match[1].replace(/,/g, '');
  if (!/^\d{1,10}$/.test(digits)) return null;
  const base = Number(digits);
  return base <= MAX_QUANTITY ? base : null;
}

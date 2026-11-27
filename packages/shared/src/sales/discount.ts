import { z } from 'zod';
import {
  MAX_SALE_TOTAL_POISHA,
  parsePercentToBasisPoints,
  parseTakaToPoisha,
} from '../money/money.js';

/** A discount is a fixed amount (poisha) or a percentage (basis points, 0–100%). */
export const discountSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('amount'),
    amountPoisha: z.number().int().min(0).max(MAX_SALE_TOTAL_POISHA),
  }),
  z.object({
    type: z.literal('percent'),
    percentBp: z.number().int().min(0).max(10_000),
  }),
]);
export type Discount = z.infer<typeof discountSchema>;

export type ParsedDiscount = { ok: true; discount: Discount | null } | { ok: false };

/**
 * Parses what a cashier types: "" → no discount, "10%" → 10 percent, "50" or
 * "৳50.50" → a fixed amount in taka. Anything else is rejected.
 */
export function parseDiscountInput(input: string): ParsedDiscount {
  const text = input.trim();
  if (text === '') return { ok: true, discount: null };
  if (text.endsWith('%')) {
    const percentBp = parsePercentToBasisPoints(text);
    return percentBp === null
      ? { ok: false }
      : { ok: true, discount: { type: 'percent', percentBp } };
  }
  const amountPoisha = parseTakaToPoisha(text);
  return amountPoisha === null
    ? { ok: false }
    : { ok: true, discount: { type: 'amount', amountPoisha } };
}

/** For form fields: 10% → "10%", ৳50.50 → "50.50". */
export function discountToInput(discount: Discount | null): string {
  if (discount === null) return '';
  if (discount.type === 'percent') {
    const whole = Math.floor(discount.percentBp / 100);
    const fraction = String(discount.percentBp % 100)
      .padStart(2, '0')
      .replace(/0+$/, '');
    return `${String(whole)}${fraction ? `.${fraction}` : ''}%`;
  }
  return `${String(Math.floor(discount.amountPoisha / 100))}.${String(discount.amountPoisha % 100).padStart(2, '0')}`;
}

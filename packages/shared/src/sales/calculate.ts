import type { ProductUnit } from '../inventory/units.js';
import { BASE_UNITS_PER_DISPLAY_UNIT } from '../inventory/units.js';
import { MAX_SALE_TOTAL_POISHA, roundHalfUp } from '../money/money.js';
import type { Discount } from './discount.js';

/**
 * Sale arithmetic, shared by the POS screen (live totals) and the API (the
 * authoritative calculation). Implements the rounding rule in docs/SCHEMA.md:
 *
 * 1. Line gross: quantity × unit price, rounded half up to the poisha for kg/L.
 * 2. Line discount: an amount or a percentage of the gross; never above the gross.
 * 3. Sale discount: an amount or a percentage of the sum of line nets; never above
 *    it. It is split across lines in proportion to their nets by the largest-
 *    remainder method, so the shares add up to the sale discount exactly.
 * 4. Line total = net − share. Line VAT is extracted from the line total.
 * 5. Sale totals are sums of the line values, so they always add up exactly.
 *
 * Products use bigint, so quantity × price can never overflow.
 */

export interface SaleLineInput {
  unit: ProductUnit;
  /** Base units: pieces, grams or millilitres. */
  quantity: number;
  /** VAT-inclusive, per piece / kg / litre. */
  unitPricePoisha: number;
  vatRateBp: number | null;
  discount: Discount | null;
}

export interface SaleLineTotals {
  grossPoisha: number;
  lineDiscountPoisha: number;
  /** Gross minus the line discount, before the sale discount. */
  netPoisha: number;
  /** This line's share of the whole-sale discount. */
  saleDiscountSharePoisha: number;
  /** What the customer pays for the line, VAT included. */
  totalPoisha: number;
  /** VAT contained in the line total. */
  taxPoisha: number;
}

export interface SaleTotals {
  lines: SaleLineTotals[];
  /** Sum of line gross amounts. */
  subtotalPoisha: number;
  /** Sum of line discounts. */
  lineDiscountPoisha: number;
  saleDiscountPoisha: number;
  /** lineDiscount + saleDiscount. */
  discountPoisha: number;
  /** VAT contained in the total. */
  taxPoisha: number;
  /** subtotal − discount, also the sum of line totals. */
  totalPoisha: number;
}

export type SaleCalculationError =
  | { kind: 'line_discount_exceeds_price'; line: number }
  | { kind: 'sale_discount_exceeds_total' }
  | { kind: 'amount_too_large' };

export type SaleCalculation =
  { ok: true; totals: SaleTotals } | { ok: false; error: SaleCalculationError };

/** Step 1: quantity in base units × price per display unit. */
export function lineGrossPoisha(
  unit: ProductUnit,
  quantity: number,
  unitPricePoisha: number,
): bigint {
  const product = BigInt(quantity) * BigInt(unitPricePoisha);
  const per = BigInt(BASE_UNITS_PER_DISPLAY_UNIT[unit]);
  return per === 1n ? product : roundHalfUp(product, per);
}

/** An amount discount as given; a percentage rounded half up. */
export function discountPoisha(base: bigint, discount: Discount | null): bigint {
  if (discount === null) return 0n;
  if (discount.type === 'amount') return BigInt(discount.amountPoisha);
  return roundHalfUp(base * BigInt(discount.percentBp), 10_000n);
}

/** VAT contained in a VAT-inclusive amount: total − round_half_up(total × 10000 / (10000 + rate)). */
export function extractVatPoisha(total: bigint, vatRateBp: number | null): bigint {
  if (vatRateBp === null || vatRateBp === 0 || total === 0n) return 0n;
  return total - roundHalfUp(total * 10_000n, 10_000n + BigInt(vatRateBp));
}

/**
 * Splits `amount` across `weights` in proportion, so the parts add up exactly:
 * every part gets floor(amount × weight / sum), then the leftover poisha go one
 * each to the largest remainders (earlier lines win ties). No part exceeds its
 * weight when amount ≤ sum.
 */
export function allocateProportionally(amount: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (amount === 0n || sum === 0n) return weights.map(() => 0n);
  const parts = weights.map((w) => (amount * w) / sum);
  const remainders = weights.map((w, i) => ({ i, r: (amount * w) % sum }));
  let leftover = amount - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return parts;
}

const MAX = BigInt(MAX_SALE_TOTAL_POISHA);

export function calculateSale(
  lines: readonly SaleLineInput[],
  saleDiscount: Discount | null,
): SaleCalculation {
  const gross: bigint[] = [];
  const lineDiscounts: bigint[] = [];
  const nets: bigint[] = [];
  for (const [index, line] of lines.entries()) {
    const g = lineGrossPoisha(line.unit, line.quantity, line.unitPricePoisha);
    if (g > MAX) return { ok: false, error: { kind: 'amount_too_large' } };
    const d = discountPoisha(g, line.discount);
    if (d > g) return { ok: false, error: { kind: 'line_discount_exceeds_price', line: index } };
    gross.push(g);
    lineDiscounts.push(d);
    nets.push(g - d);
  }

  const netSum = nets.reduce((a, b) => a + b, 0n);
  if (netSum > MAX) return { ok: false, error: { kind: 'amount_too_large' } };
  const saleDiscount$ = discountPoisha(netSum, saleDiscount);
  if (saleDiscount$ > netSum) return { ok: false, error: { kind: 'sale_discount_exceeds_total' } };
  const shares = allocateProportionally(saleDiscount$, nets);

  const lineTotals: SaleLineTotals[] = lines.map((line, i) => {
    const net = nets[i] ?? 0n;
    const share = shares[i] ?? 0n;
    const total = net - share;
    return {
      grossPoisha: Number(gross[i] ?? 0n),
      lineDiscountPoisha: Number(lineDiscounts[i] ?? 0n),
      netPoisha: Number(net),
      saleDiscountSharePoisha: Number(share),
      totalPoisha: Number(total),
      taxPoisha: Number(extractVatPoisha(total, line.vatRateBp)),
    };
  });

  const sum = (pick: (l: SaleLineTotals) => number) =>
    lineTotals.reduce((total, line) => total + pick(line), 0);
  const subtotalPoisha = sum((l) => l.grossPoisha);
  const lineDiscountPoisha = sum((l) => l.lineDiscountPoisha);
  const saleDiscountPoisha = Number(saleDiscount$);
  return {
    ok: true,
    totals: {
      lines: lineTotals,
      subtotalPoisha,
      lineDiscountPoisha,
      saleDiscountPoisha,
      discountPoisha: lineDiscountPoisha + saleDiscountPoisha,
      taxPoisha: sum((l) => l.taxPoisha),
      totalPoisha: sum((l) => l.totalPoisha),
    },
  };
}

/** Change to give back for a cash payment; null if the amount tendered is short. */
export function cashChangePoisha(totalPoisha: number, tenderedPoisha: number): number | null {
  return tenderedPoisha >= totalPoisha ? tenderedPoisha - totalPoisha : null;
}

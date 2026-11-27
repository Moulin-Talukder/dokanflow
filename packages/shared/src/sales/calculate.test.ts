import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  calculateSale,
  cashChangePoisha,
  discountPoisha,
  extractVatPoisha,
  lineGrossPoisha,
  type SaleLineInput,
  type SaleTotals,
} from './calculate.js';

function totals(
  lines: SaleLineInput[],
  saleDiscount: Parameters<typeof calculateSale>[1] = null,
): SaleTotals {
  const result = calculateSale(lines, saleDiscount);
  if (!result.ok) throw new Error(`unexpected error: ${result.error.kind}`);
  return result.totals;
}

/** Every invariant the rounding rule promises. */
function expectConsistent(t: SaleTotals): void {
  const sum = (pick: (l: SaleTotals['lines'][number]) => number) =>
    t.lines.reduce((a, l) => a + pick(l), 0);
  expect(t.subtotalPoisha).toBe(sum((l) => l.grossPoisha));
  expect(t.lineDiscountPoisha).toBe(sum((l) => l.lineDiscountPoisha));
  expect(sum((l) => l.saleDiscountSharePoisha)).toBe(t.saleDiscountPoisha);
  expect(t.discountPoisha).toBe(t.lineDiscountPoisha + t.saleDiscountPoisha);
  expect(t.totalPoisha).toBe(sum((l) => l.totalPoisha));
  expect(t.totalPoisha).toBe(t.subtotalPoisha - t.discountPoisha);
  expect(t.taxPoisha).toBe(sum((l) => l.taxPoisha));
  for (const l of t.lines) {
    expect(l.netPoisha).toBe(l.grossPoisha - l.lineDiscountPoisha);
    expect(l.totalPoisha).toBe(l.netPoisha - l.saleDiscountSharePoisha);
    expect(l.saleDiscountSharePoisha).toBeGreaterThanOrEqual(0);
    expect(l.saleDiscountSharePoisha).toBeLessThanOrEqual(l.netPoisha);
    expect(l.taxPoisha).toBeGreaterThanOrEqual(0);
    expect(l.taxPoisha).toBeLessThanOrEqual(l.totalPoisha);
  }
}

const rice: SaleLineInput = {
  unit: 'gram',
  quantity: 750,
  unitPricePoisha: 12000,
  vatRateBp: null,
  discount: null,
};

describe('line gross', () => {
  it('multiplies pieces exactly and rounds kg/L half up (docs/SCHEMA.md examples)', () => {
    expect(lineGrossPoisha('piece', 3, 4500)).toBe(13500n);
    expect(lineGrossPoisha('gram', 750, 12000)).toBe(9000n);
    expect(lineGrossPoisha('gram', 333, 9999)).toBe(3330n);
    expect(lineGrossPoisha('ml', 500, 15000)).toBe(7500n);
  });

  it('rounds an exact half poisha up', () => {
    // 1 g at ৳5.00/kg = 0.5 poisha → 1
    expect(lineGrossPoisha('gram', 1, 500)).toBe(1n);
    // 1 g at ৳4.99/kg = 0.499 poisha → 0
    expect(lineGrossPoisha('gram', 1, 499)).toBe(0n);
  });

  it('cannot overflow: the largest quantity × the largest price stays exact', () => {
    expect(lineGrossPoisha('piece', 1_000_000_000, 1_000_000_000)).toBe(10n ** 18n);
  });
});

describe('discounts', () => {
  it('takes amounts as given and rounds percentages half up', () => {
    expect(discountPoisha(9000n, { type: 'amount', amountPoisha: 500 })).toBe(500n);
    expect(discountPoisha(9000n, { type: 'percent', percentBp: 1000 })).toBe(900n);
    expect(discountPoisha(3333n, { type: 'percent', percentBp: 1500 })).toBe(500n); // 499.95 → 500
    expect(discountPoisha(1n, { type: 'percent', percentBp: 5000 })).toBe(1n); // 0.5 → 1
    expect(discountPoisha(9000n, null)).toBe(0n);
  });

  it('refuses a line discount above the price', () => {
    const result = calculateSale(
      [rice, { ...rice, discount: { type: 'amount', amountPoisha: 9001 } }],
      null,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'line_discount_exceeds_price', line: 1 } });
  });

  it('allows a 100% line discount and a sale discount equal to the total', () => {
    const t = totals([{ ...rice, discount: { type: 'percent', percentBp: 10_000 } }]);
    expect(t.totalPoisha).toBe(0);
    const all = totals([rice], { type: 'amount', amountPoisha: 9000 });
    expect(all.totalPoisha).toBe(0);
    expectConsistent(all);
  });

  it('refuses a sale discount above the total after line discounts', () => {
    const result = calculateSale([{ ...rice, discount: { type: 'amount', amountPoisha: 1000 } }], {
      type: 'amount',
      amountPoisha: 8001,
    });
    expect(result).toEqual({ ok: false, error: { kind: 'sale_discount_exceeds_total' } });
  });
});

describe('VAT extraction', () => {
  it('reproduces the worked examples in docs/SCHEMA.md', () => {
    expect(extractVatPoisha(10750n, 750)).toBe(750n);
    expect(extractVatPoisha(9999n, 750)).toBe(698n);
    expect(extractVatPoisha(1000n, 1500)).toBe(130n);
    expect(extractVatPoisha(1n, 750)).toBe(0n);
  });

  it('is zero without a rate, at 0%, and on a zero total', () => {
    expect(extractVatPoisha(10750n, null)).toBe(0n);
    expect(extractVatPoisha(10750n, 0)).toBe(0n);
    expect(extractVatPoisha(0n, 750)).toBe(0n);
  });

  it('at 100% VAT is exactly half (rounded down for the VAT, up for the net)', () => {
    expect(extractVatPoisha(1001n, 10_000)).toBe(500n); // net 500.5 → 501
  });
});

describe('allocateProportionally', () => {
  it('splits exactly, giving leftovers to the largest remainders', () => {
    expect(allocateProportionally(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocateProportionally(10n, [5n, 3n, 2n])).toEqual([5n, 3n, 2n]);
    expect(allocateProportionally(1n, [2n, 1n])).toEqual([1n, 0n]);
  });

  it('never gives a part more than its weight and handles zero weights', () => {
    expect(allocateProportionally(3n, [0n, 3n, 0n])).toEqual([0n, 3n, 0n]);
    expect(allocateProportionally(0n, [5n, 5n])).toEqual([0n, 0n]);
    expect(allocateProportionally(5n, [0n, 0n])).toEqual([0n, 0n]);
  });
});

describe('calculateSale', () => {
  it('handles a mixed cart with line and sale discounts and different VAT rates', () => {
    const t = totals(
      [
        { unit: 'gram', quantity: 1500, unitPricePoisha: 8550, vatRateBp: 750, discount: null },
        {
          unit: 'piece',
          quantity: 3,
          unitPricePoisha: 4500,
          vatRateBp: 1500,
          discount: { type: 'percent', percentBp: 1000 },
        },
        {
          unit: 'ml',
          quantity: 500,
          unitPricePoisha: 18000,
          vatRateBp: null,
          discount: { type: 'amount', amountPoisha: 250 },
        },
      ],
      { type: 'amount', amountPoisha: 1000 },
    );
    expect(t.lines.map((l) => l.grossPoisha)).toEqual([12825, 13500, 9000]);
    expect(t.lines.map((l) => l.lineDiscountPoisha)).toEqual([0, 1350, 250]);
    expect(t.subtotalPoisha).toBe(35325);
    expect(t.saleDiscountPoisha).toBe(1000);
    expect(t.totalPoisha).toBe(35325 - 1600 - 1000);
    expectConsistent(t);
  });

  it('keeps the sale discount exact when every line share has to round', () => {
    // Three equal lines and a ৳1.00 discount: 33.33… each → 34 + 33 + 33.
    const line: SaleLineInput = {
      unit: 'piece',
      quantity: 1,
      unitPricePoisha: 999,
      vatRateBp: 750,
      discount: null,
    };
    const t = totals([line, line, line], { type: 'amount', amountPoisha: 100 });
    expect(t.lines.map((l) => l.saleDiscountSharePoisha)).toEqual([34, 33, 33]);
    expect(t.totalPoisha).toBe(2897);
    expectConsistent(t);
  });

  it('keeps a percentage sale discount exact across awkward weighed lines', () => {
    const t = totals(
      [
        { unit: 'gram', quantity: 333, unitPricePoisha: 9999, vatRateBp: 750, discount: null },
        { unit: 'gram', quantity: 667, unitPricePoisha: 9999, vatRateBp: 750, discount: null },
        { unit: 'ml', quantity: 1, unitPricePoisha: 333, vatRateBp: 1500, discount: null },
      ],
      { type: 'percent', percentBp: 333 },
    );
    expectConsistent(t);
    // 3.33% of (3330 + 6669 + 0) = 332.9667 → 333.
    expect(t.saleDiscountPoisha).toBe(333);
  });

  it('refuses amounts beyond the largest sale total', () => {
    const result = calculateSale(
      [
        {
          unit: 'piece',
          quantity: 3,
          unitPricePoisha: 1_000_000_000,
          vatRateBp: null,
          discount: null,
        },
      ],
      null,
    );
    expect(result).toEqual({ ok: false, error: { kind: 'amount_too_large' } });
  });

  it('holds every invariant for 5,000 random carts (seeded)', () => {
    let seed = 42;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const units = ['piece', 'gram', 'ml'] as const;
    for (let cart = 0; cart < 5000; cart++) {
      const lines: SaleLineInput[] = Array.from({ length: 1 + random(8) }, () => {
        const unit = units[random(3)] ?? 'piece';
        const price = random(50_000);
        const gross = Number(lineGrossPoisha(unit, 1 + random(5000), price));
        return {
          unit,
          quantity: 1 + random(5000),
          unitPricePoisha: price,
          vatRateBp: random(3) === 0 ? null : random(2001),
          discount:
            random(3) === 0
              ? { type: 'percent' as const, percentBp: random(10_001) }
              : random(2) === 0
                ? { type: 'amount' as const, amountPoisha: random(Math.max(1, gross)) }
                : null,
        };
      });
      const result = calculateSale(
        lines,
        random(2) === 0 ? { type: 'percent', percentBp: random(10_001) } : null,
      );
      if (result.ok) expectConsistent(result.totals);
    }
  });
});

describe('cashChangePoisha', () => {
  it('returns the change, or null when the cash is short', () => {
    expect(cashChangePoisha(35000, 50000)).toBe(15000);
    expect(cashChangePoisha(35000, 35000)).toBe(0);
    expect(cashChangePoisha(35000, 34999)).toBeNull();
  });
});

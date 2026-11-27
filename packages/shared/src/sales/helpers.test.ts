import { describe, expect, it } from 'vitest';
import { parseQuantityWithUnit } from '../inventory/units.js';
import { discountToInput, parseDiscountInput } from './discount.js';
import { formatInvoiceNumber, parseInvoiceNumber } from './invoice-number.js';
import { createSaleRequestSchema } from './schemas.js';

describe('parseQuantityWithUnit', () => {
  it.each([
    ['1.5 kg', 'gram', 1500],
    ['1.5', 'gram', 1500],
    ['500 g', 'gram', 500],
    ['500g', 'gram', 500],
    ['0.5 L', 'ml', 500],
    ['250 ml', 'ml', 250],
    ['2', 'ml', 2000],
    ['3', 'piece', 3],
    ['3 pcs', 'piece', 3],
    ['1,000 g', 'gram', 1000],
  ] as const)('parses %j for %s as %i', (input, unit, expected) => {
    expect(parseQuantityWithUnit(input, unit)).toBe(expected);
  });

  it.each([
    ['1.5 g', 'gram'], // grams are whole
    ['500 ml', 'gram'], // wrong unit
    ['2 kg', 'piece'],
    ['1.5', 'piece'],
    ['-1 kg', 'gram'],
    ['abc', 'gram'],
    ['', 'gram'],
  ] as const)('rejects %j for %s', (input, unit) => {
    expect(parseQuantityWithUnit(input, unit)).toBeNull();
  });
});

describe('parseDiscountInput', () => {
  it('reads percentages, amounts and blanks', () => {
    expect(parseDiscountInput('10%')).toEqual({
      ok: true,
      discount: { type: 'percent', percentBp: 1000 },
    });
    expect(parseDiscountInput('7.5 %')).toEqual({
      ok: true,
      discount: { type: 'percent', percentBp: 750 },
    });
    expect(parseDiscountInput('50')).toEqual({
      ok: true,
      discount: { type: 'amount', amountPoisha: 5000 },
    });
    expect(parseDiscountInput('৳12.50')).toEqual({
      ok: true,
      discount: { type: 'amount', amountPoisha: 1250 },
    });
    expect(parseDiscountInput('  ')).toEqual({ ok: true, discount: null });
  });

  it('rejects nonsense and percentages above 100', () => {
    expect(parseDiscountInput('abc')).toEqual({ ok: false });
    expect(parseDiscountInput('101%')).toEqual({ ok: false });
    expect(parseDiscountInput('-5')).toEqual({ ok: false });
  });

  it('round-trips through the form representation', () => {
    for (const text of ['10%', '7.5%', '50.00', '0.01']) {
      const parsed = parseDiscountInput(text);
      expect(parsed.ok && discountToInput(parsed.discount)).toBe(text);
    }
  });
});

describe('invoice numbers', () => {
  it('formats and parses', () => {
    expect(formatInvoiceNumber(123)).toBe('INV-000123');
    expect(formatInvoiceNumber(1234567)).toBe('INV-1234567');
    for (const input of ['INV-000123', 'inv-123', '000123', '123', ' INV123 ']) {
      expect(parseInvoiceNumber(input)).toBe(123);
    }
    expect(parseInvoiceNumber('INV-0')).toBeNull();
    expect(parseInvoiceNumber('abc')).toBeNull();
  });
});

describe('createSaleRequestSchema', () => {
  const productId = '0b6f1c8e-9a1d-4a53-8f0e-5e2b4d3c2a10';
  const base = {
    lines: [{ productId, quantity: 1500 }],
    payment: { method: 'cash', tenderedPoisha: 20000 },
    expectedTotalPoisha: 12825,
  };

  it('defaults discounts to null', () => {
    expect(createSaleRequestSchema.parse(base)).toMatchObject({
      lines: [{ productId, quantity: 1500, discount: null }],
      saleDiscount: null,
    });
  });

  it('rejects an empty cart, a repeated product and non-cash payments (for now)', () => {
    expect(createSaleRequestSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({ ...base, lines: [base.lines[0], base.lines[0]] }).success,
    ).toBe(false);
    expect(
      createSaleRequestSchema.safeParse({ ...base, payment: { method: 'card', tenderedPoisha: 1 } })
        .success,
    ).toBe(false);
  });
});

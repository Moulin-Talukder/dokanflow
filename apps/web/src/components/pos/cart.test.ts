import type { Product } from '@dokanflow/shared';
import { describe, expect, it } from 'vitest';
import { idempotencyKeySchema } from '@dokanflow/shared';
import { addToCart, type CartState, emptyCart, evaluateCart, saleIdempotencyKey } from './cart';

function product(overrides: Partial<Product>): Product {
  return {
    id: crypto.randomUUID(),
    name: 'Item',
    sku: 'ITEM',
    barcode: null,
    category: null,
    unit: 'piece',
    pricePoisha: 4500,
    costPoisha: 3000,
    vatRateBp: null,
    lowStockThreshold: null,
    archived: false,
    stockQuantity: 100,
    isLowStock: false,
    unitLocked: false,
    createdAt: '2026-11-27T00:00:00.000Z',
    updatedAt: '2026-11-27T00:00:00.000Z',
    ...overrides,
  };
}

const rice = product({ name: 'Rice', unit: 'gram', pricePoisha: 8550, vatRateBp: 750 });
const soap = product({ name: 'Soap', pricePoisha: 4500, vatRateBp: 1500 });

describe('addToCart', () => {
  it('adds new items with quantity 1 and increments pieces scanned again', () => {
    let lines = addToCart([], soap);
    lines = addToCart(lines, soap);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantityInput).toBe('2');
  });

  it('leaves the quantity of a weighed item for the cashier to type', () => {
    const lines = addToCart(addToCart([], rice), rice);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantityInput).toBe('1');
  });
});

describe('evaluateCart', () => {
  const cart = (overrides: Partial<CartState>): CartState => ({ ...emptyCart, ...overrides });

  it('computes live totals with weighed quantities and discounts', () => {
    const result = evaluateCart(
      cart({
        lines: [
          { product: rice, quantityInput: '1.5 kg', discountInput: '' },
          { product: soap, quantityInput: '3', discountInput: '10%' },
        ],
        saleDiscountInput: '10',
        cashInput: '400',
      }),
    );
    expect(result.totals).toMatchObject({
      subtotalPoisha: 12825 + 13500,
      lineDiscountPoisha: 1350,
      saleDiscountPoisha: 1000,
      totalPoisha: 12825 + 13500 - 1350 - 1000,
    });
    expect(result.changePoisha).toBe(40000 - 23975);
    expect(result.request).toEqual({
      lines: [
        { productId: rice.id, quantity: 1500, discount: null },
        { productId: soap.id, quantity: 3, discount: { type: 'percent', percentBp: 1000 } },
      ],
      saleDiscount: { type: 'amount', amountPoisha: 1000 },
      payment: { method: 'cash', tenderedPoisha: 40000 },
      expectedTotalPoisha: 23975,
    });
  });

  it('accepts grams as well as kg for weighed items', () => {
    const result = evaluateCart(
      cart({ lines: [{ product: rice, quantityInput: '500 g', discountInput: '' }] }),
    );
    expect(result.totals?.totalPoisha).toBe(4275);
  });

  it('flags invalid quantities and discounts per line, and shows no totals', () => {
    const result = evaluateCart(
      cart({
        lines: [
          { product: soap, quantityInput: '1.5', discountInput: '' },
          { product: rice, quantityInput: '1', discountInput: 'abc' },
        ],
      }),
    );
    expect(result.lineIssues).toEqual(['invalid_quantity', 'invalid_discount']);
    expect(result.totals).toBeNull();
    expect(result.request).toBeNull();
  });

  it('refuses a discount above the price, and a sale discount above the total', () => {
    expect(
      evaluateCart(cart({ lines: [{ product: soap, quantityInput: '1', discountInput: '46' }] }))
        .lineIssues,
    ).toEqual(['discount_too_large']);
    expect(
      evaluateCart(
        cart({
          lines: [{ product: soap, quantityInput: '1', discountInput: '' }],
          saleDiscountInput: '45.01',
        }),
      ).saleDiscountIssue,
    ).toBe('too_large');
  });

  it('needs enough cash before the sale can be sent', () => {
    const lines = [{ product: soap, quantityInput: '1', discountInput: '' }];
    const short = evaluateCart(cart({ lines, cashInput: '44.99' }));
    expect(short.cashShort).toBe(true);
    expect(short.request).toBeNull();
    const exact = evaluateCart(cart({ lines, cashInput: '45' }));
    expect(exact.changePoisha).toBe(0);
    expect(exact.request).not.toBeNull();
    expect(evaluateCart(cart({ lines })).request).toBeNull(); // no cash entered yet
  });

  it('an empty cart has no totals and nothing to send', () => {
    const result = evaluateCart(emptyCart);
    expect(result.totals).toBeNull();
    expect(result.request).toBeNull();
  });
});

describe('saleIdempotencyKey', () => {
  const request = evaluateCart({
    lines: [{ product: soap, quantityInput: '1', discountInput: '' }],
    saleDiscountInput: '',
    cashInput: '45',
  }).request;
  if (!request) throw new Error('expected a request');

  it('is stable for the same cart, so a double-click sends the same key', () => {
    expect(saleIdempotencyKey('abc123', 0, request)).toBe(saleIdempotencyKey('abc123', 0, request));
  });

  it('changes with the cart and after each completed sale', () => {
    const other = { ...request, payment: { method: 'cash' as const, tenderedPoisha: 5000 } };
    expect(saleIdempotencyKey('abc123', 0, other)).not.toBe(
      saleIdempotencyKey('abc123', 0, request),
    );
    expect(saleIdempotencyKey('abc123', 1, request)).not.toBe(
      saleIdempotencyKey('abc123', 0, request),
    );
  });

  it('is a valid Idempotency-Key header value', () => {
    const key = saleIdempotencyKey(crypto.randomUUID().replace(/-/g, ''), 12, request);
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
  });
});

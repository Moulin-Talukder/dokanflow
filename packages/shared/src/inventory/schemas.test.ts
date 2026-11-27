import { describe, expect, it } from 'vitest';
import {
  createProductRequestSchema,
  productListQuerySchema,
  stockAdjustmentRequestSchema,
  stockInRequestSchema,
  updateProductRequestSchema,
} from './schemas.js';

const valid = {
  name: ' Miniket Rice ',
  sku: ' rice-mini-5kg ',
  unit: 'gram',
  pricePoisha: 8500,
  costPoisha: 7800,
};

describe('createProductRequestSchema', () => {
  it('normalizes the name and SKU and defaults optional fields to null', () => {
    expect(createProductRequestSchema.parse(valid)).toEqual({
      name: 'Miniket Rice',
      sku: 'RICE-MINI-5KG',
      barcode: null,
      categoryId: null,
      unit: 'gram',
      pricePoisha: 8500,
      costPoisha: 7800,
      vatRateBp: null,
      lowStockThreshold: null,
    });
  });

  it('rejects fractional or negative money, and VAT above 100%', () => {
    expect(createProductRequestSchema.safeParse({ ...valid, pricePoisha: 85.5 }).success).toBe(
      false,
    );
    expect(createProductRequestSchema.safeParse({ ...valid, costPoisha: -1 }).success).toBe(false);
    expect(createProductRequestSchema.safeParse({ ...valid, vatRateBp: 10_001 }).success).toBe(
      false,
    );
  });

  it('rejects SKUs with spaces or symbols and unknown units', () => {
    expect(createProductRequestSchema.safeParse({ ...valid, sku: 'RICE 5KG' }).success).toBe(false);
    expect(createProductRequestSchema.safeParse({ ...valid, sku: '-RICE' }).success).toBe(false);
    expect(createProductRequestSchema.safeParse({ ...valid, unit: 'kg' }).success).toBe(false);
  });
});

describe('updateProductRequestSchema', () => {
  it('accepts partial changes but not an empty body', () => {
    expect(updateProductRequestSchema.parse({ archived: true })).toEqual({ archived: true });
    expect(updateProductRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('stock request schemas', () => {
  it('stock in must be a positive whole number of base units', () => {
    expect(stockInRequestSchema.safeParse({ quantity: 1500 }).success).toBe(true);
    expect(stockInRequestSchema.safeParse({ quantity: 0 }).success).toBe(false);
    expect(stockInRequestSchema.safeParse({ quantity: 1.5 }).success).toBe(false);
  });

  it('adjustments need a non-zero change and a reason', () => {
    expect(
      stockAdjustmentRequestSchema.safeParse({ delta: -500, reason: 'Damaged bag' }).success,
    ).toBe(true);
    const noReason = stockAdjustmentRequestSchema.safeParse({ delta: -500, reason: '  ' });
    expect(noReason.success).toBe(false);
    expect(noReason.error?.issues[0]?.message).toBe('validation.reasonRequired');
    expect(stockAdjustmentRequestSchema.safeParse({ delta: 0, reason: 'Count' }).success).toBe(
      false,
    );
  });
});

describe('productListQuerySchema', () => {
  it('coerces query-string values and applies defaults', () => {
    expect(productListQuerySchema.parse({ page: '2', lowStock: 'true' })).toEqual({
      page: 2,
      pageSize: 20,
      lowStock: true,
      includeArchived: false,
    });
  });

  it('caps the page size', () => {
    expect(productListQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
});

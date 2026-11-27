import { describe, expect, it } from 'vitest';
import { productFormSchema } from './product-form-schema';
import { toQueryString } from './query-string';

const filled = {
  name: 'Miniket Rice',
  sku: 'rice-5kg',
  barcode: '',
  categoryId: '',
  unit: 'gram' as const,
  price: '85.50',
  cost: '78',
  vat: '7.5',
  threshold: '2.5',
};

describe('productFormSchema', () => {
  it('converts what people type into the API request, exactly', () => {
    expect(productFormSchema.parse(filled)).toEqual({
      name: 'Miniket Rice',
      sku: 'RICE-5KG',
      barcode: null,
      categoryId: null,
      unit: 'gram',
      pricePoisha: 8550,
      costPoisha: 7800,
      vatRateBp: 750,
      lowStockThreshold: 2500, // 2.5 kg in grams
    });
  });

  it('leaves optional VAT and threshold empty as null', () => {
    const result = productFormSchema.parse({ ...filled, vat: '', threshold: ' ' });
    expect(result.vatRateBp).toBeNull();
    expect(result.lowStockThreshold).toBeNull();
  });

  it('reports invalid money, percentages and quantities on the right fields', () => {
    const result = productFormSchema.safeParse({
      ...filled,
      unit: 'piece',
      price: '12.345',
      vat: '101',
      threshold: '1.5', // pieces must be whole
    });
    expect(result.success).toBe(false);
    const issues = Object.fromEntries(
      (result.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]),
    );
    expect(issues).toMatchObject({
      price: 'validation.money',
      vat: 'validation.percent',
      threshold: 'validation.quantity',
    });
  });
});

describe('toQueryString', () => {
  it('keeps set values and drops empty ones', () => {
    expect(toQueryString({ search: 'oil', categoryId: '', lowStock: 'true', page: 2 })).toBe(
      'search=oil&lowStock=true&page=2',
    );
  });
});

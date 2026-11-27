import {
  type CreateProductInput,
  createProductRequestSchema,
  parseDisplayQuantity,
  parsePercentToBasisPoints,
  parseTakaToPoisha,
  productUnitSchema,
} from '@dokanflow/shared';
import { z } from 'zod';

/**
 * Form fields are what people type (taka, %, kg). They are converted exactly to
 * the API's integers (poisha, basis points, grams) by the shared helpers, then
 * validated by the same schema the API uses.
 */
export const productFormSchema = z
  .object({
    name: z.string(),
    sku: z.string(),
    barcode: z.string(),
    categoryId: z.string(),
    unit: productUnitSchema,
    price: z.string(),
    cost: z.string(),
    vat: z.string(),
    threshold: z.string(),
  })
  .transform((v, ctx): CreateProductInput => {
    const pricePoisha = parseTakaToPoisha(v.price);
    if (pricePoisha === null)
      ctx.addIssue({ code: 'custom', path: ['price'], message: 'validation.money' });
    const costPoisha = parseTakaToPoisha(v.cost);
    if (costPoisha === null)
      ctx.addIssue({ code: 'custom', path: ['cost'], message: 'validation.money' });
    const vatRateBp = v.vat.trim() === '' ? null : parsePercentToBasisPoints(v.vat);
    if (v.vat.trim() !== '' && vatRateBp === null) {
      ctx.addIssue({ code: 'custom', path: ['vat'], message: 'validation.percent' });
    }
    const lowStockThreshold =
      v.threshold.trim() === '' ? null : parseDisplayQuantity(v.threshold, v.unit);
    if (v.threshold.trim() !== '' && lowStockThreshold === null) {
      ctx.addIssue({ code: 'custom', path: ['threshold'], message: 'validation.quantity' });
    }
    return {
      name: v.name,
      sku: v.sku,
      barcode: v.barcode.trim() === '' ? null : v.barcode,
      categoryId: v.categoryId === '' ? null : v.categoryId,
      unit: v.unit,
      pricePoisha: pricePoisha ?? 0,
      costPoisha: costPoisha ?? 0,
      vatRateBp,
      lowStockThreshold,
    };
  })
  .pipe(createProductRequestSchema);

export type ProductFormInput = z.input<typeof productFormSchema>;

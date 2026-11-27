import { z } from 'zod';
import { MAX_PRICE_POISHA } from '../money/money.js';
import { MAX_QUANTITY, productUnitSchema } from './units.js';

const name = z.string().trim().min(1, 'validation.required').max(120, 'validation.tooLong');

/** SKUs are case-insensitive identifiers, stored uppercase: "rice-5kg" and "RICE-5KG" are one SKU. */
export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, 'validation.sku');

export const barcodeSchema = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z-]{4,64}$/, 'validation.barcode');

const poisha = z
  .number('validation.required')
  .int('validation.wholeNumber')
  .min(0, 'validation.nonNegative')
  .max(MAX_PRICE_POISHA, 'validation.tooLarge');

/** VAT rate in basis points, 0–100%. */
const vatRateBp = z
  .number()
  .int('validation.wholeNumber')
  .min(0, 'validation.nonNegative')
  .max(10_000, 'validation.tooLarge');

/** Base units (pieces, grams, millilitres). */
const baseQuantity = z
  .number()
  .int('validation.wholeNumber')
  .min(0, 'validation.nonNegative')
  .max(MAX_QUANTITY, 'validation.tooLarge');

// --- Categories ---------------------------------------------------------------

export const createCategoryRequestSchema = z.object({ name });
export type CreateCategoryRequest = z.infer<typeof createCategoryRequestSchema>;

export const categorySchema = z.object({ id: z.uuid(), name: z.string() });
export type Category = z.infer<typeof categorySchema>;

export const categoryListResponseSchema = z.object({ items: z.array(categorySchema) });
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;

// --- Products -----------------------------------------------------------------

export const createProductRequestSchema = z.object({
  name,
  sku: skuSchema,
  barcode: barcodeSchema.nullable().default(null),
  categoryId: z.uuid().nullable().default(null),
  unit: productUnitSchema,
  /** Shelf price including VAT, per piece, per kg or per litre. */
  pricePoisha: poisha,
  costPoisha: poisha,
  vatRateBp: vatRateBp.nullable().default(null),
  /** In base units; at or below this the product is low on stock. */
  lowStockThreshold: baseQuantity.nullable().default(null),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
export type CreateProductInput = z.input<typeof createProductRequestSchema>;

/** Every field optional; `archived` archives or restores the product. */
export const updateProductRequestSchema = z
  .object({
    name,
    sku: skuSchema,
    barcode: barcodeSchema.nullable(),
    categoryId: z.uuid().nullable(),
    unit: productUnitSchema,
    pricePoisha: poisha,
    costPoisha: poisha,
    vatRateBp: vatRateBp.nullable(),
    lowStockThreshold: baseQuantity.nullable(),
    archived: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'validation.noChanges' });
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

export const productSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  sku: z.string(),
  barcode: z.string().nullable(),
  category: categorySchema.nullable(),
  unit: productUnitSchema,
  pricePoisha: z.number().int(),
  costPoisha: z.number().int(),
  vatRateBp: z.number().int().nullable(),
  lowStockThreshold: z.number().int().nullable(),
  archived: z.boolean(),
  /** At the shop's default branch, in base units. */
  stockQuantity: z.number().int(),
  isLowStock: z.boolean(),
  /** True once any stock movement exists; the unit can then no longer change. */
  unitLocked: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Product = z.infer<typeof productSchema>;

export const PAGE_SIZE_MAX = 100;

const page = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20);
const booleanParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .default(false);

export const productListQuerySchema = z.object({
  /** Matches name or SKU (case-insensitive substring) or barcode (exact). */
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  lowStock: booleanParam,
  includeArchived: booleanParam,
  page,
  pageSize,
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type ProductListQueryInput = z.input<typeof productListQuerySchema>;

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
  });
}

export const productListResponseSchema = paginatedSchema(productSchema);
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

// --- Stock --------------------------------------------------------------------

export const stockMovementTypeSchema = z.enum([
  'opening',
  'purchase',
  'adjustment',
  'sale',
  'sale_void',
  'return',
]);
export type StockMovementType = z.infer<typeof stockMovementTypeSchema>;

/** Stock received (a purchase). Quantity in base units, always positive. */
export const stockInRequestSchema = z.object({
  quantity: baseQuantity.min(1, 'validation.positive'),
  note: z.string().trim().max(200, 'validation.tooLong').optional(),
});
export type StockInRequest = z.infer<typeof stockInRequestSchema>;

/** A correction (count, damage, loss). Signed change in base units, with a reason. */
export const stockAdjustmentRequestSchema = z.object({
  delta: z
    .number()
    .int('validation.wholeNumber')
    .min(-MAX_QUANTITY, 'validation.tooLarge')
    .max(MAX_QUANTITY, 'validation.tooLarge')
    .refine((v) => v !== 0, 'validation.nonZero'),
  reason: z.string().trim().min(3, 'validation.reasonRequired').max(200, 'validation.tooLong'),
});
export type StockAdjustmentRequest = z.infer<typeof stockAdjustmentRequestSchema>;

export const stockMovementSchema = z.object({
  id: z.uuid(),
  type: stockMovementTypeSchema,
  quantityDelta: z.number().int(),
  quantityAfter: z.number().int(),
  reason: z.string().nullable(),
  actor: z.object({ id: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
});
export type StockMovement = z.infer<typeof stockMovementSchema>;

export const movementListQuerySchema = z.object({ page, pageSize });
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;

export const stockMovementListResponseSchema = paginatedSchema(stockMovementSchema);
export type StockMovementListResponse = z.infer<typeof stockMovementListResponseSchema>;

/** Returned by stock-in and adjustment: the new level and the movement that made it. */
export const stockChangeResponseSchema = z.object({
  stockQuantity: z.number().int().min(0),
  isLowStock: z.boolean(),
  movement: stockMovementSchema,
});
export type StockChangeResponse = z.infer<typeof stockChangeResponseSchema>;

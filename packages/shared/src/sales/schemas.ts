import { z } from 'zod';
import { paginatedSchema, PAGE_SIZE_MAX } from '../inventory/schemas.js';
import { MAX_QUANTITY, productUnitSchema } from '../inventory/units.js';
import { MAX_SALE_TOTAL_POISHA } from '../money/money.js';
import { discountSchema } from './discount.js';

/** Header for idempotent writes (sales, stock in, adjustments). */
export const IDEMPOTENCY_HEADER = 'idempotency-key';
/** A random id per attempt, e.g. a UUID. */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'validation.idempotencyKey');

const poisha = z.number().int().min(0).max(MAX_SALE_TOTAL_POISHA);

export const saleLineRequestSchema = z.object({
  productId: z.uuid(),
  /** Base units: pieces, grams or millilitres. */
  quantity: z
    .number()
    .int('validation.wholeNumber')
    .min(1, 'validation.positive')
    .max(MAX_QUANTITY),
  discount: discountSchema.nullable().default(null),
});
export type SaleLineRequest = z.infer<typeof saleLineRequestSchema>;

/**
 * How the sale is paid. Phase 4 accepts cash only, paid in full; card, mobile
 * wallet and due are added in Phase 5 as more members of this union.
 */
export const salePaymentRequestSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('cash'), tenderedPoisha: poisha }),
]);
export type SalePaymentRequest = z.infer<typeof salePaymentRequestSchema>;

export const createSaleRequestSchema = z
  .object({
    lines: z
      .array(saleLineRequestSchema)
      .min(1, 'validation.emptyCart')
      .max(200, 'validation.tooLarge'),
    saleDiscount: discountSchema.nullable().default(null),
    payment: salePaymentRequestSchema,
    /**
     * The total the cashier saw. The server recalculates from current prices and
     * refuses (409 TOTAL_MISMATCH) if they differ, so nobody is charged an amount
     * they were not shown.
     */
    expectedTotalPoisha: poisha,
  })
  .refine((v) => new Set(v.lines.map((l) => l.productId)).size === v.lines.length, {
    path: ['lines'],
    message: 'validation.duplicateProduct',
  });
export type CreateSaleRequest = z.infer<typeof createSaleRequestSchema>;
export type CreateSaleInput = z.input<typeof createSaleRequestSchema>;

export const voidSaleRequestSchema = z.object({
  reason: z.string().trim().min(3, 'validation.reasonRequired').max(200, 'validation.tooLong'),
});
export type VoidSaleRequest = z.infer<typeof voidSaleRequestSchema>;

export const saleStatusSchema = z.enum(['completed', 'voided']);
export type SaleStatus = z.infer<typeof saleStatusSchema>;

export const paymentMethodSchema = z.enum(['cash', 'card', 'mobile_wallet', 'due']);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validation.date');

/** Dates are calendar days in Asia/Dhaka, inclusive. */
export const saleListQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Invoice number: "INV-000123" or "123". */
  search: z.string().trim().max(20).optional(),
  status: saleStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(20),
});
export type SaleListQuery = z.infer<typeof saleListQuerySchema>;

const person = z.object({ id: z.uuid(), name: z.string() });

export const saleLineSchema = z.object({
  lineNo: z.number().int(),
  productId: z.uuid(),
  productName: z.string(),
  productSku: z.string(),
  unit: productUnitSchema,
  quantity: z.number().int(),
  unitPricePoisha: z.number().int(),
  grossPoisha: z.number().int(),
  discount: discountSchema.nullable(),
  lineDiscountPoisha: z.number().int(),
  saleDiscountSharePoisha: z.number().int(),
  totalPoisha: z.number().int(),
  vatRateBp: z.number().int().nullable(),
  taxPoisha: z.number().int(),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const salePaymentSchema = z.object({
  method: paymentMethodSchema,
  amountPoisha: z.number().int(),
  tenderedPoisha: z.number().int().nullable(),
  changePoisha: z.number().int().nullable(),
});
export type SalePayment = z.infer<typeof salePaymentSchema>;

export const saleSummarySchema = z.object({
  id: z.uuid(),
  invoiceNo: z.number().int(),
  invoiceNumber: z.string(),
  status: saleStatusSchema,
  cashier: person,
  totalPoisha: z.number().int(),
  itemCount: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type SaleSummary = z.infer<typeof saleSummarySchema>;

export const saleSchema = saleSummarySchema.extend({
  shopName: z.string(),
  subtotalPoisha: z.number().int(),
  lineDiscountPoisha: z.number().int(),
  saleDiscount: discountSchema.nullable(),
  saleDiscountPoisha: z.number().int(),
  discountPoisha: z.number().int(),
  taxPoisha: z.number().int(),
  paidPoisha: z.number().int(),
  duePoisha: z.number().int(),
  lines: z.array(saleLineSchema),
  payments: z.array(salePaymentSchema),
  void: z.object({ at: z.iso.datetime(), by: person, reason: z.string() }).nullable(),
});
export type Sale = z.infer<typeof saleSchema>;

export const saleListResponseSchema = paginatedSchema(saleSummarySchema);
export type SaleListResponse = z.infer<typeof saleListResponseSchema>;

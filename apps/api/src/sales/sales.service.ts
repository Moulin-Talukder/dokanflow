import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type TransactionClient, withDbContext } from '@dokanflow/db';
import {
  applyStockDelta,
  calculateSale,
  cashChangePoisha,
  type CreateSaleRequest,
  type Discount,
  formatInvoiceNumber,
  formatPoisha,
  parseInvoiceNumber,
  type ProductUnit,
  type Sale,
  type SaleListQuery,
  type SaleListResponse,
  type ValidationIssue,
  validationMessageEn,
  type VoidSaleRequest,
} from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { ApiHttpException } from '../common/api-http.exception.js';
import { claimIdempotencyKey, completeIdempotencyKey, requestHash } from '../common/idempotency.js';
import { RequestValidationException } from '../common/request-validation.exception.js';
import { PrismaService } from '../infra/prisma.service.js';
import { mapInventoryDbError } from '../inventory/db-errors.js';
import { defaultBranchId } from '../inventory/default-branch.js';

interface LockedProduct {
  id: string;
  name: string;
  sku: string;
  unit: ProductUnit;
  price_poisha: number;
  vat_rate_bp: number | null;
  archived_at: Date | null;
}

/** Asia/Dhaka is UTC+6 all year (no daylight saving), so a calendar day is exact. */
function dhakaDayStart(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+06:00`);
}

function discountColumns(discount: Discount | null): {
  type: 'amount' | 'percent' | null;
  value: number | null;
} {
  if (discount === null) return { type: null, value: null };
  return discount.type === 'amount'
    ? { type: 'amount', value: discount.amountPoisha }
    : { type: 'percent', value: discount.percentBp };
}

function discountFromColumns(
  type: 'amount' | 'percent' | null,
  value: number | null,
): Discount | null {
  if (type === null || value === null) return null;
  return type === 'amount' ? { type, amountPoisha: value } : { type, percentBp: value };
}

const saleInclude = {
  cashier: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  items: { orderBy: { lineNo: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SaleInclude;

type SaleWithRelations = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

export interface CreateSaleResult {
  sale: Sale;
  replayed: boolean;
}

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a cash sale in one transaction: claim the idempotency key, lock the
   * products (in id order, so concurrent sales cannot deadlock), check stock,
   * recalculate totals from current prices, allocate the next invoice number,
   * then write the sale, its lines, the payment and the sale stock movements.
   */
  async create(
    auth: AuthContext,
    idempotencyKey: string,
    input: CreateSaleRequest,
  ): Promise<CreateSaleResult> {
    let outcome: { id: string; replayed: boolean };
    try {
      outcome = await withDbContext(
        this.prisma.client,
        auth,
        async (tx) => {
          const claim = await claimIdempotencyKey(
            tx,
            auth.tenantId,
            'sale',
            idempotencyKey,
            requestHash(input),
          );
          if (claim.status === 'replay') {
            return { id: claim.resourceId, replayed: true };
          }
          const id = await this.insertSale(tx, auth, input);
          await completeIdempotencyKey(tx, auth.tenantId, 'sale', idempotencyKey, id);
          return { id, replayed: false };
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      mapInventoryDbError(error);
    }
    return { sale: await this.get(auth, outcome.id), replayed: outcome.replayed };
  }

  private async insertSale(
    tx: TransactionClient,
    auth: AuthContext,
    input: CreateSaleRequest,
  ): Promise<string> {
    const productIds = input.lines.map((l) => l.productId);
    const products = await tx.$queryRaw<LockedProduct[]>`
      SELECT id, name, sku, unit::text AS unit, price_poisha, vat_rate_bp, archived_at
      FROM products
      WHERE tenant_id = ${auth.tenantId}::uuid AND id = ANY(${productIds}::uuid[])
      ORDER BY id
      FOR NO KEY UPDATE`;
    const byId = new Map(products.map((p) => [p.id, p]));

    // Pair each cart line with its locked product; a product of another shop is
    // invisible under RLS and so "not found".
    const pairs = input.lines.map((line, i) => {
      const product = byId.get(line.productId);
      if (!product) {
        throw new NotFoundException(`Product not found (line ${String(i + 1)})`);
      }
      return { line, product };
    });
    const archived = pairs.map((p) => p.product).find((p) => p.archived_at !== null);
    if (archived) {
      throw new ConflictException(`"${archived.name}" is archived and cannot be sold`);
    }

    // Stock check under the product locks: clear 409 naming each short line.
    const branchId = await defaultBranchId(tx, auth.tenantId);
    const levels = await tx.$queryRaw<{ product_id: string; quantity: number }[]>`
      SELECT product_id, quantity FROM stock_levels
      WHERE tenant_id = ${auth.tenantId}::uuid AND branch_id = ${branchId}::uuid
        AND product_id = ANY(${productIds}::uuid[])`;
    const stock = new Map(levels.map((l) => [l.product_id, l.quantity]));
    const short: ValidationIssue[] = [];
    pairs.forEach(({ line, product }, i) => {
      if (!applyStockDelta(stock.get(line.productId) ?? 0, -line.quantity).ok) {
        short.push({
          path: `lines.${String(i)}.quantity`,
          message: `Not enough stock for "${product.name}"`,
        });
      }
    });
    if (short.length > 0) {
      throw new ApiHttpException(
        409,
        'INSUFFICIENT_STOCK',
        short.map((s) => s.message).join('; '),
        short,
      );
    }

    // Totals from current prices; the client's numbers are never trusted.
    const calculation = calculateSale(
      pairs.map(({ line, product }) => ({
        unit: product.unit,
        quantity: line.quantity,
        unitPricePoisha: product.price_poisha,
        vatRateBp: product.vat_rate_bp,
        discount: line.discount,
      })),
      input.saleDiscount,
    );
    if (!calculation.ok) {
      const { error } = calculation;
      throw new RequestValidationException([
        error.kind === 'line_discount_exceeds_price'
          ? {
              path: `lines.${String(error.line)}.discount`,
              message: 'The discount is more than the price',
            }
          : error.kind === 'sale_discount_exceeds_total'
            ? { path: 'saleDiscount', message: 'The discount is more than the total' }
            : { path: 'lines', message: 'The sale total is too large' },
      ]);
    }
    const totals = calculation.totals;
    if (totals.totalPoisha !== input.expectedTotalPoisha) {
      throw new ApiHttpException(
        409,
        'TOTAL_MISMATCH',
        `Prices have changed: the total is now ${formatPoisha(totals.totalPoisha)}`,
      );
    }
    const change = cashChangePoisha(totals.totalPoisha, input.payment.tenderedPoisha);
    if (change === null) {
      throw new RequestValidationException([
        { path: 'payment.tenderedPoisha', message: validationMessageEn('validation.paymentShort') },
      ]);
    }

    // Next invoice number: one row per tenant, locked until commit, rolled back with
    // the sale on failure, so numbers are sequential with no gaps or duplicates.
    const [counter] = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO invoice_counters (tenant_id, last_value) VALUES (${auth.tenantId}::uuid, 1)
      ON CONFLICT (tenant_id) DO UPDATE SET last_value = invoice_counters.last_value + 1
      RETURNING last_value`;
    if (!counter) throw new Error('Invoice counter did not return a value');

    const saleDiscount = discountColumns(input.saleDiscount);
    const sale = await tx.sale.create({
      data: {
        tenantId: auth.tenantId,
        branchId,
        invoiceNo: counter.last_value,
        cashierUserId: auth.userId,
        subtotalPoisha: totals.subtotalPoisha,
        lineDiscountPoisha: totals.lineDiscountPoisha,
        saleDiscountType: saleDiscount.type,
        saleDiscountValue: saleDiscount.value,
        saleDiscountPoisha: totals.saleDiscountPoisha,
        taxPoisha: totals.taxPoisha,
        totalPoisha: totals.totalPoisha,
        paidPoisha: totals.totalPoisha,
        duePoisha: 0,
      },
      select: { id: true },
    });

    await tx.saleItem.createMany({
      data: pairs.map(({ line, product }, i) => {
        const lineTotals = totals.lines[i];
        if (!lineTotals) throw new Error('Line totals missing');
        const discount = discountColumns(line.discount);
        return {
          tenantId: auth.tenantId,
          saleId: sale.id,
          lineNo: i + 1,
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          unit: product.unit,
          quantity: line.quantity,
          unitPricePoisha: product.price_poisha,
          grossPoisha: lineTotals.grossPoisha,
          discountType: discount.type,
          discountValue: discount.value,
          lineDiscountPoisha: lineTotals.lineDiscountPoisha,
          saleDiscountSharePoisha: lineTotals.saleDiscountSharePoisha,
          totalPoisha: lineTotals.totalPoisha,
          vatRateBp: product.vat_rate_bp,
          taxPoisha: lineTotals.taxPoisha,
        };
      }),
    });

    await tx.salePayment.create({
      data: {
        tenantId: auth.tenantId,
        saleId: sale.id,
        method: 'cash',
        amountPoisha: totals.totalPoisha,
        tenderedPoisha: input.payment.tenderedPoisha,
        changePoisha: change,
      },
    });

    // Stock out, in product-id order (the order the products were locked in).
    const lines = [...input.lines].sort((a, b) => (a.productId < b.productId ? -1 : 1));
    await tx.stockMovement.createMany({
      data: lines.map((line) => ({
        tenantId: auth.tenantId,
        branchId,
        productId: line.productId,
        type: 'sale' as const,
        quantityDelta: -line.quantity,
        referenceType: 'sale',
        referenceId: sale.id,
        actorUserId: auth.userId,
      })),
    });
    return sale.id;
  }

  async get(auth: AuthContext, saleId: string): Promise<Sale> {
    return withDbContext(this.prisma.client, auth, async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId }, include: saleInclude });
      if (!sale) throw new NotFoundException('Sale not found');
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { name: true },
      });
      return toSale(sale, tenant.name);
    });
  }

  async list(auth: AuthContext, query: SaleListQuery): Promise<SaleListResponse> {
    const invoiceNo = query.search ? parseInvoiceNumber(query.search) : undefined;
    if (invoiceNo === null) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    }
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = dhakaDayStart(query.from);
    if (query.to) createdAt.lt = new Date(dhakaDayStart(query.to).getTime() + 24 * 60 * 60 * 1000);
    const where: Prisma.SaleWhereInput = {
      tenantId: auth.tenantId,
      ...(invoiceNo !== undefined ? { invoiceNo } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
    };
    return withDbContext(this.prisma.client, auth, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.sale.findMany({
          where,
          include: {
            cashier: { select: { id: true, name: true } },
            _count: { select: { items: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { invoiceNo: 'desc' }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
        }),
        tx.sale.count({ where }),
      ]);
      return {
        items: rows.map((s) => ({
          id: s.id,
          invoiceNo: s.invoiceNo,
          invoiceNumber: formatInvoiceNumber(s.invoiceNo),
          status: s.status,
          cashier: s.cashier,
          totalPoisha: s.totalPoisha,
          itemCount: s._count.items,
          createdAt: s.createdAt.toISOString(),
        })),
        page: query.page,
        pageSize: query.pageSize,
        total,
      };
    });
  }

  /**
   * Voids a completed sale: restores its stock with sale_void movements and marks
   * it voided, keeping it for the record. The sale row is locked first, so
   * concurrent voids cannot restore stock twice.
   */
  async void(auth: AuthContext, saleId: string, input: VoidSaleRequest): Promise<Sale> {
    try {
      await withDbContext(this.prisma.client, auth, async (tx) => {
        const [sale] = await tx.$queryRaw<
          { id: string; status: string; branch_id: string; invoice_no: number }[]
        >`
          SELECT id, status::text AS status, branch_id, invoice_no FROM sales
          WHERE tenant_id = ${auth.tenantId}::uuid AND id = ${saleId}::uuid
          FOR UPDATE`;
        if (!sale) throw new NotFoundException('Sale not found');
        if (sale.status === 'voided') {
          throw new ApiHttpException(409, 'ALREADY_VOIDED', 'This sale has already been voided');
        }
        const items = await tx.saleItem.findMany({
          where: { saleId },
          select: { productId: true, quantity: true },
          orderBy: { productId: 'asc' },
        });
        const productIds = items.map((i) => i.productId);
        await tx.$queryRaw`
          SELECT id FROM products
          WHERE tenant_id = ${auth.tenantId}::uuid AND id = ANY(${productIds}::uuid[])
          ORDER BY id FOR NO KEY UPDATE`;
        await tx.stockMovement.createMany({
          data: items.map((item) => ({
            tenantId: auth.tenantId,
            branchId: sale.branch_id,
            productId: item.productId,
            type: 'sale_void' as const,
            quantityDelta: item.quantity,
            reason: `Void of ${formatInvoiceNumber(sale.invoice_no)}: ${input.reason}`,
            referenceType: 'sale',
            referenceId: saleId,
            actorUserId: auth.userId,
          })),
        });
        await tx.sale.update({
          where: { id: saleId },
          data: {
            status: 'voided',
            voidedAt: new Date(),
            voidedByUserId: auth.userId,
            voidReason: input.reason,
          },
        });
      });
    } catch (error) {
      if (error instanceof Error && 'getStatus' in error) throw error;
      if (error instanceof Error && error.message.includes('sale_already_voided')) {
        throw new ApiHttpException(409, 'ALREADY_VOIDED', 'This sale has already been voided');
      }
      mapInventoryDbError(error);
    }
    return this.get(auth, saleId);
  }
}

function toSale(sale: SaleWithRelations, shopName: string): Sale {
  return {
    id: sale.id,
    invoiceNo: sale.invoiceNo,
    invoiceNumber: formatInvoiceNumber(sale.invoiceNo),
    status: sale.status,
    cashier: sale.cashier,
    totalPoisha: sale.totalPoisha,
    itemCount: sale.items.length,
    createdAt: sale.createdAt.toISOString(),
    shopName,
    subtotalPoisha: sale.subtotalPoisha,
    lineDiscountPoisha: sale.lineDiscountPoisha,
    saleDiscount: discountFromColumns(sale.saleDiscountType, sale.saleDiscountValue),
    saleDiscountPoisha: sale.saleDiscountPoisha,
    discountPoisha: sale.lineDiscountPoisha + sale.saleDiscountPoisha,
    taxPoisha: sale.taxPoisha,
    paidPoisha: sale.paidPoisha,
    duePoisha: sale.duePoisha,
    lines: sale.items.map((item) => ({
      lineNo: item.lineNo,
      productId: item.productId,
      productName: item.productName,
      productSku: item.productSku,
      unit: item.unit,
      quantity: item.quantity,
      unitPricePoisha: item.unitPricePoisha,
      grossPoisha: item.grossPoisha,
      discount: discountFromColumns(item.discountType, item.discountValue),
      lineDiscountPoisha: item.lineDiscountPoisha,
      saleDiscountSharePoisha: item.saleDiscountSharePoisha,
      totalPoisha: item.totalPoisha,
      vatRateBp: item.vatRateBp,
      taxPoisha: item.taxPoisha,
    })),
    payments: sale.payments.map((p) => ({
      method: p.method,
      amountPoisha: p.amountPoisha,
      tenderedPoisha: p.tenderedPoisha,
      changePoisha: p.changePoisha,
    })),
    void:
      sale.status === 'voided' && sale.voidedAt && sale.voidedBy && sale.voidReason
        ? { at: sale.voidedAt.toISOString(), by: sale.voidedBy, reason: sale.voidReason }
        : null,
  };
}

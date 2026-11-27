import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPrismaClient,
  type PrismaClient,
  type TransactionClient,
  withDbContext,
} from '../src/index.js';
import { assertConnectedToTestDatabase } from '../src/testing.js';
import { testTargets } from './env.js';

/**
 * Sales rules enforced by the database itself (as app_user): immutability except
 * voiding, the void guard, totals verified against lines and payments at commit,
 * and tenant isolation on every sales table.
 */
interface Shop {
  tenantId: string;
  branchId: string;
  userId: string;
  productId: string;
}

describe('sales (database level)', () => {
  let app: PrismaClient;
  let a: Shop;
  let b: Shop;
  const run = randomUUID().slice(0, 8);
  let invoice = 0;

  const ctx = (shop: Shop) => ({ tenantId: shop.tenantId, userId: shop.userId });

  async function seedShop(label: string): Promise<Shop> {
    const shop = {
      tenantId: randomUUID(),
      branchId: randomUUID(),
      userId: randomUUID(),
      productId: randomUUID(),
    };
    await app.user.create({
      data: {
        id: shop.userId,
        name: `Owner ${label}`,
        email: `sales-${label}-${run}@test.local`,
        passwordHash: 'x',
      },
    });
    await app.tenant.create({ data: { id: shop.tenantId, name: `Sales ${label} ${run}` } });
    await withDbContext(app, ctx(shop), async (tx) => {
      await tx.branch.create({
        data: { id: shop.branchId, tenantId: shop.tenantId, name: 'Main', isDefault: true },
      });
      await tx.membership.create({
        data: { tenantId: shop.tenantId, userId: shop.userId, role: 'owner' },
      });
      await tx.product.create({
        data: {
          id: shop.productId,
          tenantId: shop.tenantId,
          name: 'Soap',
          sku: `SOAP-${run.toUpperCase()}`,
          unit: 'piece',
          pricePoisha: 1000,
          costPoisha: 500,
        },
      });
    });
    return shop;
  }

  /** A consistent one-line cash sale of `total` poisha, written directly. */
  async function insertSale(
    tx: TransactionClient,
    shop: Shop,
    total = 1000,
    overrides: { itemTotal?: number } = {},
  ) {
    invoice += 1;
    const sale = await tx.sale.create({
      data: {
        tenantId: shop.tenantId,
        branchId: shop.branchId,
        invoiceNo: invoice,
        cashierUserId: shop.userId,
        subtotalPoisha: total,
        lineDiscountPoisha: 0,
        saleDiscountPoisha: 0,
        taxPoisha: 0,
        totalPoisha: total,
        paidPoisha: total,
        duePoisha: 0,
      },
    });
    const itemTotal = overrides.itemTotal ?? total;
    await tx.saleItem.create({
      data: {
        tenantId: shop.tenantId,
        saleId: sale.id,
        lineNo: 1,
        productId: shop.productId,
        productName: 'Soap',
        productSku: 'SOAP',
        unit: 'piece',
        quantity: 1,
        unitPricePoisha: itemTotal,
        grossPoisha: itemTotal,
        lineDiscountPoisha: 0,
        saleDiscountSharePoisha: 0,
        totalPoisha: itemTotal,
        taxPoisha: 0,
      },
    });
    await tx.salePayment.create({
      data: {
        tenantId: shop.tenantId,
        saleId: sale.id,
        method: 'cash',
        amountPoisha: total,
        tenderedPoisha: total,
        changePoisha: 0,
      },
    });
    return sale;
  }

  beforeAll(async () => {
    app = createPrismaClient({ connectionString: testTargets.databaseUrl, maxConnections: 4 });
    await assertConnectedToTestDatabase(app);
    a = await seedShop('a');
    b = await seedShop('b');
  });

  afterAll(async () => {
    await app.$disconnect();
  });

  it('accepts a sale whose totals match its lines and payment', async () => {
    const sale = await withDbContext(app, ctx(a), (tx) => insertSale(tx, a));
    expect(sale.totalPoisha).toBe(1000);
  });

  it('rejects, at commit, a sale whose lines do not add up to its total', async () => {
    await expect(
      withDbContext(app, ctx(a), (tx) => insertSale(tx, a, 1000, { itemTotal: 999 })),
    ).rejects.toThrow(/sale_totals_inconsistent/);
  });

  it('rejects, at commit, a sale with no lines', async () => {
    await expect(
      withDbContext(app, ctx(a), (tx) =>
        tx.sale.create({
          data: {
            tenantId: a.tenantId,
            branchId: a.branchId,
            invoiceNo: 9999,
            cashierUserId: a.userId,
            subtotalPoisha: 0,
            lineDiscountPoisha: 0,
            saleDiscountPoisha: 0,
            taxPoisha: 0,
            totalPoisha: 0,
            paidPoisha: 0,
            duePoisha: 0,
          },
        }),
      ),
    ).rejects.toThrow(/sale_totals_inconsistent/);
  });

  it('rejects a line added later that would break the totals', async () => {
    const sale = await withDbContext(app, ctx(a), (tx) => insertSale(tx, a));
    await expect(
      withDbContext(app, ctx(a), (tx) =>
        tx.saleItem.create({
          data: {
            tenantId: a.tenantId,
            saleId: sale.id,
            lineNo: 2,
            productId: a.productId,
            productName: 'Extra',
            productSku: 'X',
            unit: 'piece',
            quantity: 1,
            unitPricePoisha: 100,
            grossPoisha: 100,
            lineDiscountPoisha: 0,
            saleDiscountSharePoisha: 0,
            totalPoisha: 100,
            taxPoisha: 0,
          },
        }),
      ),
    ).rejects.toThrow(/sale_totals_inconsistent/);
  });

  it('keeps sales immutable: only the void columns can change, nothing can be deleted', async () => {
    const sale = await withDbContext(app, ctx(a), (tx) => insertSale(tx, a));
    const attempt = (sql: (tx: TransactionClient) => Promise<unknown>) =>
      expect(withDbContext(app, ctx(a), sql)).rejects.toThrow(/permission denied/i);
    await attempt(
      (tx) => tx.$executeRaw`UPDATE sales SET total_poisha = 1 WHERE id = ${sale.id}::uuid`,
    );
    await attempt((tx) => tx.$executeRaw`DELETE FROM sales WHERE id = ${sale.id}::uuid`);
    await attempt(
      (tx) =>
        tx.$executeRaw`UPDATE sale_items SET total_poisha = 1 WHERE sale_id = ${sale.id}::uuid`,
    );
    await attempt((tx) => tx.$executeRaw`DELETE FROM sale_items WHERE sale_id = ${sale.id}::uuid`);
    await attempt(
      (tx) =>
        tx.$executeRaw`UPDATE sale_payments SET amount_poisha = 1 WHERE sale_id = ${sale.id}::uuid`,
    );
    await attempt(
      (tx) => tx.$executeRaw`DELETE FROM sale_payments WHERE sale_id = ${sale.id}::uuid`,
    );
  });

  it('voids once: a voided sale can never change again', async () => {
    const sale = await withDbContext(app, ctx(a), (tx) => insertSale(tx, a));
    await withDbContext(app, ctx(a), (tx) =>
      tx.sale.update({
        where: { id: sale.id },
        data: {
          status: 'voided',
          voidedAt: new Date(),
          voidedByUserId: a.userId,
          voidReason: 'Wrong item',
        },
      }),
    );
    await expect(
      withDbContext(app, ctx(a), (tx) =>
        tx.sale.update({
          where: { id: sale.id },
          data: { status: 'completed', voidedAt: null, voidedByUserId: null, voidReason: null },
        }),
      ),
    ).rejects.toThrow(/sale_already_voided/);
  });

  it('requires who, when and a reason for a void', async () => {
    const sale = await withDbContext(app, ctx(a), (tx) => insertSale(tx, a));
    await expect(
      withDbContext(app, ctx(a), (tx) =>
        tx.sale.update({ where: { id: sale.id }, data: { status: 'voided' } }),
      ),
    ).rejects.toThrow(/sales_void_fields/);
  });

  it('hides every sales table from other shops and refuses cross-shop writes', async () => {
    const sale = await withDbContext(app, ctx(a), async (tx) => {
      const created = await insertSale(tx, a);
      await tx.$executeRaw`INSERT INTO invoice_counters (tenant_id, last_value) VALUES (${a.tenantId}::uuid, 1)
                           ON CONFLICT (tenant_id) DO NOTHING`;
      await tx.$executeRaw`INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash)
                           VALUES (${a.tenantId}::uuid, 'sale', ${`key-${run}`}, 'hash')`;
      return created;
    });
    const seenByB = await withDbContext(app, ctx(b), async (tx) => ({
      sales: await tx.sale.count({ where: { id: sale.id } }),
      items: await tx.saleItem.count({ where: { saleId: sale.id } }),
      payments: await tx.salePayment.count({ where: { saleId: sale.id } }),
      counters: await tx.invoiceCounter.count({ where: { tenantId: a.tenantId } }),
      keys: await tx.idempotencyKey.count({ where: { tenantId: a.tenantId } }),
    }));
    expect(seenByB).toEqual({ sales: 0, items: 0, payments: 0, counters: 0, keys: 0 });

    await expect(
      withDbContext(
        app,
        ctx(b),
        (tx) =>
          tx.$executeRaw`UPDATE invoice_counters SET last_value = 0 WHERE tenant_id = ${a.tenantId}::uuid`,
      ),
    ).resolves.toBe(0);
    await expect(
      withDbContext(app, ctx(b), (tx) => insertSale(tx, { ...b, tenantId: a.tenantId })),
    ).rejects.toThrow(/row-level security/i);
  });
});

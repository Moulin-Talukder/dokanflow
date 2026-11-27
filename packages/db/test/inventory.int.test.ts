import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient, withDbContext } from '../src/index.js';
import { assertConnectedToTestDatabase } from '../src/testing.js';
import { testTargets } from './env.js';

/**
 * Inventory rules enforced by the database itself, tested as app_user with no
 * application code in between: RLS, the stock trigger, append-only movements,
 * the unit lock and the stock invariant.
 */
interface Shop {
  tenantId: string;
  branchId: string;
  userId: string;
}

describe('inventory (database level)', () => {
  let app: PrismaClient;
  let a: Shop;
  let b: Shop;
  const run = randomUUID().slice(0, 8);

  async function seedShop(label: string): Promise<Shop> {
    const shop = { tenantId: randomUUID(), branchId: randomUUID(), userId: randomUUID() };
    await app.user.create({
      data: {
        id: shop.userId,
        name: `Owner ${label}`,
        email: `inv-${label}-${run}@test.local`,
        passwordHash: 'x',
      },
    });
    await app.tenant.create({ data: { id: shop.tenantId, name: `Inventory ${label} ${run}` } });
    await withDbContext(app, { tenantId: shop.tenantId, userId: shop.userId }, async (tx) => {
      await tx.branch.create({
        data: { id: shop.branchId, tenantId: shop.tenantId, name: 'Main', isDefault: true },
      });
      await tx.membership.create({
        data: { tenantId: shop.tenantId, userId: shop.userId, role: 'owner' },
      });
    });
    return shop;
  }

  const ctx = (shop: Shop) => ({ tenantId: shop.tenantId, userId: shop.userId });

  async function createProduct(shop: Shop, unit: 'piece' | 'gram' | 'ml' = 'gram') {
    return withDbContext(app, ctx(shop), (tx) =>
      tx.product.create({
        data: {
          tenantId: shop.tenantId,
          name: 'Rice',
          sku: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`,
          unit,
          pricePoisha: 8500,
          costPoisha: 7800,
        },
      }),
    );
  }

  function move(
    shop: Shop,
    productId: string,
    quantityDelta: number,
    type: 'purchase' | 'adjustment' | 'sale' = quantityDelta > 0 ? 'purchase' : 'adjustment',
  ) {
    return withDbContext(app, ctx(shop), (tx) =>
      tx.stockMovement.create({
        data: {
          tenantId: shop.tenantId,
          branchId: shop.branchId,
          productId,
          type,
          quantityDelta,
          reason: type === 'adjustment' ? 'Counted shelf' : null,
          actorUserId: shop.userId,
        },
      }),
    );
  }

  function level(shop: Shop, productId: string) {
    return withDbContext(app, ctx(shop), (tx) =>
      tx.stockLevel.findUnique({
        where: {
          tenantId_branchId_productId: {
            tenantId: shop.tenantId,
            branchId: shop.branchId,
            productId,
          },
        },
      }),
    );
  }

  beforeAll(async () => {
    app = createPrismaClient({ connectionString: testTargets.databaseUrl, maxConnections: 12 });
    await assertConnectedToTestDatabase(app);
    a = await seedShop('a');
    b = await seedShop('b');
  });

  afterAll(async () => {
    await app.$disconnect();
  });

  describe('stock changes only through movements', () => {
    it('applies each movement to the level and records quantity_after', async () => {
      const product = await createProduct(a);
      const first = await move(a, product.id, 2500);
      const second = await move(a, product.id, -400);
      expect(first.quantityAfter).toBe(2500);
      expect(second.quantityAfter).toBe(2100);
      expect((await level(a, product.id))?.quantity).toBe(2100);
    });

    it('ignores a quantity_after supplied by the caller', async () => {
      const product = await createProduct(a);
      const movement = await withDbContext(app, ctx(a), (tx) =>
        tx.stockMovement.create({
          data: {
            tenantId: a.tenantId,
            branchId: a.branchId,
            productId: product.id,
            type: 'purchase',
            quantityDelta: 10,
            quantityAfter: 999_999,
            actorUserId: a.userId,
          },
        }),
      );
      expect(movement.quantityAfter).toBe(10);
    });

    it('refuses a movement that would take stock below zero, and changes nothing', async () => {
      const product = await createProduct(a);
      await move(a, product.id, 300);
      await expect(move(a, product.id, -301)).rejects.toThrow(/insufficient_stock/);
      expect((await level(a, product.id))?.quantity).toBe(300);
      const count = await withDbContext(app, ctx(a), (tx) =>
        tx.stockMovement.count({ where: { productId: product.id } }),
      );
      expect(count).toBe(1);
    });

    it('keeps the level equal to the sum of all movements (reconciliation query)', async () => {
      const product = await createProduct(a);
      for (const delta of [1000, -250, 500, -1250, 30, 70]) {
        await move(a, product.id, delta);
      }
      const drift = await withDbContext(
        app,
        ctx(a),
        (tx) =>
          tx.$queryRaw<{ product_id: string }[]>`
          SELECT l.product_id
          FROM stock_levels l
          LEFT JOIN stock_movements m
            ON m.tenant_id = l.tenant_id AND m.branch_id = l.branch_id AND m.product_id = l.product_id
          GROUP BY l.tenant_id, l.branch_id, l.product_id, l.quantity
          HAVING l.quantity <> COALESCE(SUM(m.quantity_delta), 0)`,
      );
      expect(drift).toEqual([]);
      expect((await level(a, product.id))?.quantity).toBe(100);
    });

    it('does not lose updates under concurrent movements', async () => {
      const product = await createProduct(a, 'piece');
      await Promise.all(Array.from({ length: 20 }, () => move(a, product.id, 1)));
      expect((await level(a, product.id))?.quantity).toBe(20);
    });

    it('never oversells under concurrent removals', async () => {
      const product = await createProduct(a, 'piece');
      await move(a, product.id, 5);
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => move(a, product.id, -1)),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      expect((await level(a, product.id))?.quantity).toBe(0);
    });
  });

  describe('privileges', () => {
    it('lets app_user read stock levels but never write them directly', async () => {
      const product = await createProduct(a);
      await move(a, product.id, 100);
      await expect(
        withDbContext(
          app,
          ctx(a),
          (tx) =>
            tx.$executeRaw`UPDATE stock_levels SET quantity = 999999 WHERE product_id = ${product.id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withDbContext(
          app,
          ctx(a),
          (tx) =>
            tx.$executeRaw`INSERT INTO stock_levels (tenant_id, branch_id, product_id, quantity)
                         VALUES (${a.tenantId}::uuid, ${a.branchId}::uuid, ${product.id}::uuid, 5)`,
        ),
      ).rejects.toThrow(/permission denied/i);
      expect((await level(a, product.id))?.quantity).toBe(100);
    });

    it('keeps stock_movements append-only', async () => {
      const product = await createProduct(a);
      const movement = await move(a, product.id, 100);
      await expect(
        withDbContext(
          app,
          ctx(a),
          (tx) =>
            tx.$executeRaw`UPDATE stock_movements SET quantity_delta = 5 WHERE id = ${movement.id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        withDbContext(
          app,
          ctx(a),
          (tx) => tx.$executeRaw`DELETE FROM stock_movements WHERE id = ${movement.id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('does not let products be deleted (archive instead)', async () => {
      const product = await createProduct(a);
      await expect(
        withDbContext(app, ctx(a), (tx) => tx.product.delete({ where: { id: product.id } })),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  describe('movement rules', () => {
    it('requires a reason of at least 3 characters for adjustments', async () => {
      const product = await createProduct(a);
      await move(a, product.id, 100);
      await expect(
        withDbContext(app, ctx(a), (tx) =>
          tx.stockMovement.create({
            data: {
              tenantId: a.tenantId,
              branchId: a.branchId,
              productId: product.id,
              type: 'adjustment',
              quantityDelta: -10,
              reason: '  ',
              actorUserId: a.userId,
            },
          }),
        ),
      ).rejects.toThrow(/stock_movements_adjustment_reason/);
    });

    it('only lets purchases add stock', async () => {
      const product = await createProduct(a);
      await move(a, product.id, 100);
      await expect(move(a, product.id, -10, 'purchase')).rejects.toThrow(
        /stock_movements_direction/,
      );
    });
  });

  describe('unit lock', () => {
    it('allows changing the unit before any stock movement', async () => {
      const product = await createProduct(a, 'gram');
      const updated = await withDbContext(app, ctx(a), (tx) =>
        tx.product.update({ where: { id: product.id }, data: { unit: 'ml' } }),
      );
      expect(updated.unit).toBe('ml');
    });

    it('refuses to change the unit once stock has moved, but allows other edits', async () => {
      const product = await createProduct(a, 'gram');
      await move(a, product.id, 500);
      await expect(
        withDbContext(app, ctx(a), (tx) =>
          tx.product.update({ where: { id: product.id }, data: { unit: 'piece' } }),
        ),
      ).rejects.toThrow(/product_unit_locked/);
      const renamed = await withDbContext(app, ctx(a), (tx) =>
        tx.product.update({ where: { id: product.id }, data: { name: 'Renamed rice' } }),
      );
      expect(renamed.unit).toBe('gram');
    });
  });

  describe('tenant isolation', () => {
    it("hides another shop's products, levels and movements", async () => {
      const product = await createProduct(a);
      await move(a, product.id, 100);
      const seenByB = await withDbContext(app, ctx(b), async (tx) => ({
        product: await tx.product.findUnique({ where: { id: product.id } }),
        levels: await tx.stockLevel.count({ where: { productId: product.id } }),
        movements: await tx.stockMovement.count({ where: { productId: product.id } }),
      }));
      expect(seenByB).toEqual({ product: null, levels: 0, movements: 0 });
    });

    it("refuses to move stock of another shop's product, even with that shop's ids", async () => {
      const product = await createProduct(a);
      // tenant_id of A while acting as B: RLS WITH CHECK rejects it.
      await expect(
        withDbContext(app, ctx(b), (tx) =>
          tx.stockMovement.create({
            data: {
              tenantId: a.tenantId,
              branchId: a.branchId,
              productId: product.id,
              type: 'purchase',
              quantityDelta: 100,
              actorUserId: b.userId,
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      // B's own tenant id but A's product and branch: the composite foreign keys reject it.
      await expect(
        withDbContext(app, ctx(b), (tx) =>
          tx.stockMovement.create({
            data: {
              tenantId: b.tenantId,
              branchId: a.branchId,
              productId: product.id,
              type: 'purchase',
              quantityDelta: 100,
              actorUserId: b.userId,
            },
          }),
        ),
      ).rejects.toThrow();
      expect((await level(a, product.id))?.quantity ?? 0).toBe(0);
    });

    it("refuses to link a product to another shop's category", async () => {
      const categoryA = await withDbContext(app, ctx(a), (tx) =>
        tx.category.create({ data: { tenantId: a.tenantId, name: `Grains ${run}` } }),
      );
      await expect(
        withDbContext(app, ctx(b), (tx) =>
          tx.product.create({
            data: {
              tenantId: b.tenantId,
              categoryId: categoryA.id,
              name: 'Sneaky',
              sku: `SNEAKY-${run.toUpperCase()}`,
              unit: 'piece',
              pricePoisha: 100,
              costPoisha: 50,
            },
          }),
        ),
      ).rejects.toThrow(/foreign key/i);
    });

    it('lets two shops use the same SKU, but not one shop twice', async () => {
      const sku = `SHARED-${run.toUpperCase()}`;
      for (const shop of [a, b]) {
        await withDbContext(app, ctx(shop), (tx) =>
          tx.product.create({
            data: {
              tenantId: shop.tenantId,
              name: 'Oil',
              sku,
              unit: 'ml',
              pricePoisha: 1,
              costPoisha: 1,
            },
          }),
        );
      }
      await expect(
        withDbContext(app, ctx(a), (tx) =>
          tx.product.create({
            data: {
              tenantId: a.tenantId,
              name: 'Oil 2',
              sku,
              unit: 'ml',
              pricePoisha: 1,
              costPoisha: 1,
            },
          }),
        ),
      ).rejects.toThrow(/unique/i);
    });
  });
});

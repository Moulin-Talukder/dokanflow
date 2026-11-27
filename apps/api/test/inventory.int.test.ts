import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  categorySchema,
  productListResponseSchema,
  productSchema,
  stockChangeResponseSchema,
  stockMovementListResponseSchema,
} from '@dokanflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  login,
  registerOwner,
  resetRateLimits,
  type TestApp,
  toSession,
  uniqueEmail,
  uniquePhone,
} from './helpers.js';

/**
 * Products and stock over HTTP against real Postgres: stock rules, the unit lock,
 * low stock, search and pagination, role permissions and cross-tenant isolation.
 */
describe('products and inventory (integration)', () => {
  let testApp: TestApp;
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    testApp = await createTestApp();
    ({ app, server } = testApp);
  });

  beforeEach(async () => {
    await resetRateLimits(testApp);
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string): [string, string] => ['authorization', `Bearer ${token}`];

  function sku(): string {
    return `SKU-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  async function createProduct(token: string, overrides: Record<string, unknown> = {}) {
    const res = await request(server)
      .post('/api/products')
      .set(...auth(token))
      .send({
        name: 'Miniket Rice',
        sku: sku(),
        unit: 'gram',
        pricePoisha: 8500,
        costPoisha: 7800,
        ...overrides,
      })
      .expect(201);
    return productSchema.parse(res.body);
  }

  /** Each call is a new request, so each gets its own Idempotency-Key. */
  function stockIn(token: string, productId: string, quantity: number, key: string = randomUUID()) {
    return request(server)
      .post(`/api/products/${productId}/stock/in`)
      .set(...auth(token))
      .set('idempotency-key', key)
      .send({ quantity });
  }

  function adjust(
    token: string,
    productId: string,
    delta: number,
    reason = 'Shelf count',
    key: string = randomUUID(),
  ) {
    return request(server)
      .post(`/api/products/${productId}/stock/adjustments`)
      .set(...auth(token))
      .set('idempotency-key', key)
      .send({ delta, reason });
  }

  /** A staff member who has already replaced their temporary password. */
  async function staffToken(ownerToken: string, role: 'manager' | 'cashier'): Promise<string> {
    const temporaryPassword = `temp-${randomUUID()}`;
    const identifier = role === 'manager' ? uniqueEmail('inv-manager') : uniquePhone();
    await request(server)
      .post('/api/staff')
      .set(...auth(ownerToken))
      .send(
        role === 'manager'
          ? { role, name: 'Manager', email: identifier, temporaryPassword }
          : { role, name: 'Cashier', phone: identifier, temporaryPassword },
      )
      .expect(201);
    const first = await login(server, identifier, temporaryPassword);
    const changed = await request(server)
      .post('/api/auth/change-password')
      .set(...auth(first.accessToken))
      .send({ currentPassword: temporaryPassword, newPassword: `own-${randomUUID()}` })
      .expect(200);
    return toSession(changed).accessToken;
  }

  describe('products', () => {
    it('creates a product with a normalized SKU and zero stock', async () => {
      const owner = await registerOwner(server, 'inv-create');
      const product = await createProduct(owner.accessToken, {
        sku: ' rice-mini-5kg ',
        vatRateBp: 750,
        lowStockThreshold: 2000,
      });
      expect(product).toMatchObject({
        sku: 'RICE-MINI-5KG',
        unit: 'gram',
        pricePoisha: 8500,
        vatRateBp: 750,
        stockQuantity: 0,
        isLowStock: true,
        unitLocked: false,
        archived: false,
      });
    });

    it('rejects a duplicate SKU in the same shop, case-insensitively, but not across shops', async () => {
      const a = await registerOwner(server, 'inv-sku-a');
      const b = await registerOwner(server, 'inv-sku-b');
      const shared = sku();
      await createProduct(a.accessToken, { sku: shared });
      const dup = await request(server)
        .post('/api/products')
        .set(...auth(a.accessToken))
        .send({
          name: 'Other',
          sku: shared.toLowerCase(),
          unit: 'piece',
          pricePoisha: 1,
          costPoisha: 1,
        })
        .expect(409);
      expect(apiErrorSchema.parse(dup.body).error.message).toMatch(/SKU/);
      await createProduct(b.accessToken, { sku: shared });
    });

    it('rejects fractional money and VAT above 100%', async () => {
      const owner = await registerOwner(server, 'inv-money');
      for (const bad of [{ pricePoisha: 85.5 }, { costPoisha: -1 }, { vatRateBp: 10_001 }]) {
        await request(server)
          .post('/api/products')
          .set(...auth(owner.accessToken))
          .send({
            name: 'Bad',
            sku: sku(),
            unit: 'piece',
            pricePoisha: 100,
            costPoisha: 50,
            ...bad,
          })
          .expect(400);
      }
    });

    it('archives and restores, hiding archived products from the default list', async () => {
      const owner = await registerOwner(server, 'inv-archive');
      const product = await createProduct(owner.accessToken);
      await request(server)
        .patch(`/api/products/${product.id}`)
        .set(...auth(owner.accessToken))
        .send({ archived: true })
        .expect(200);
      const list = await request(server)
        .get('/api/products')
        .set(...auth(owner.accessToken));
      expect(productListResponseSchema.parse(list.body).total).toBe(0);
      const withArchived = await request(server)
        .get('/api/products?includeArchived=true')
        .set(...auth(owner.accessToken));
      expect(productListResponseSchema.parse(withArchived.body).total).toBe(1);
      // No stock changes while archived.
      await stockIn(owner.accessToken, product.id, 10).expect(409);
    });
  });

  describe('stock rules', () => {
    it('records stock in and adjustments as movements, newest first', async () => {
      const owner = await registerOwner(server, 'inv-stock');
      const product = await createProduct(owner.accessToken);

      const received = stockChangeResponseSchema.parse(
        (await stockIn(owner.accessToken, product.id, 2500).expect(201)).body,
      );
      expect(received).toMatchObject({
        stockQuantity: 2500,
        movement: { type: 'purchase', quantityDelta: 2500, quantityAfter: 2500 },
      });
      const adjusted = stockChangeResponseSchema.parse(
        (await adjust(owner.accessToken, product.id, -500, 'Torn bag').expect(201)).body,
      );
      expect(adjusted).toMatchObject({
        stockQuantity: 2000,
        movement: { type: 'adjustment', quantityDelta: -500, reason: 'Torn bag' },
      });

      const history = stockMovementListResponseSchema.parse(
        (
          await request(server)
            .get(`/api/products/${product.id}/stock/movements`)
            .set(...auth(owner.accessToken))
            .expect(200)
        ).body,
      );
      expect(history.total).toBe(2);
      expect(history.items.map((m) => m.quantityAfter)).toEqual([2000, 2500]);
      expect(history.items[0]?.actor.name).toBe(owner.body.session.user.name);
    });

    it('refuses to take stock below zero with INSUFFICIENT_STOCK', async () => {
      const owner = await registerOwner(server, 'inv-neg');
      const product = await createProduct(owner.accessToken, { unit: 'piece' });
      await stockIn(owner.accessToken, product.id, 3).expect(201);
      const res = await adjust(owner.accessToken, product.id, -4).expect(409);
      expect(apiErrorSchema.parse(res.body).error.code).toBe('INSUFFICIENT_STOCK');
      const after = productSchema.parse(
        (
          await request(server)
            .get(`/api/products/${product.id}`)
            .set(...auth(owner.accessToken))
        ).body,
      );
      expect(after.stockQuantity).toBe(3);
    });

    it('requires a reason for adjustments and a positive stock-in quantity', async () => {
      const owner = await registerOwner(server, 'inv-reason');
      const product = await createProduct(owner.accessToken);
      const res = await adjust(owner.accessToken, product.id, 100, ' ').expect(400);
      expect(apiErrorSchema.parse(res.body).error.issues?.[0]).toEqual({
        path: 'reason',
        message: 'Give a reason (at least 3 characters)',
      });
      await stockIn(owner.accessToken, product.id, 0).expect(400);
      await stockIn(owner.accessToken, product.id, 1.5).expect(400);
    });

    it('keeps the stock level equal to the sum of movements under concurrent changes', async () => {
      const owner = await registerOwner(server, 'inv-concurrent');
      const product = await createProduct(owner.accessToken, { unit: 'piece' });
      await stockIn(owner.accessToken, product.id, 10).expect(201);
      const results = await Promise.all(
        Array.from({ length: 15 }, () => adjust(owner.accessToken, product.id, -1)),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(10);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);

      const after = productSchema.parse(
        (
          await request(server)
            .get(`/api/products/${product.id}`)
            .set(...auth(owner.accessToken))
        ).body,
      );
      expect(after.stockQuantity).toBe(0);
      const history = stockMovementListResponseSchema.parse(
        (
          await request(server)
            .get(`/api/products/${product.id}/stock/movements?pageSize=100`)
            .set(...auth(owner.accessToken))
        ).body,
      );
      const sum = history.items.reduce((total, m) => total + m.quantityDelta, 0);
      expect(sum).toBe(after.stockQuantity);
    });
  });

  describe('unit lock', () => {
    it('allows changing the unit before stock moves, and refuses with UNIT_LOCKED after', async () => {
      const owner = await registerOwner(server, 'inv-unit');
      const product = await createProduct(owner.accessToken, { unit: 'gram' });
      const changed = await request(server)
        .patch(`/api/products/${product.id}`)
        .set(...auth(owner.accessToken))
        .send({ unit: 'ml' })
        .expect(200);
      expect(productSchema.parse(changed.body).unit).toBe('ml');

      await stockIn(owner.accessToken, product.id, 500).expect(201);
      const locked = await request(server)
        .patch(`/api/products/${product.id}`)
        .set(...auth(owner.accessToken))
        .send({ unit: 'piece' })
        .expect(409);
      expect(apiErrorSchema.parse(locked.body).error.code).toBe('UNIT_LOCKED');

      const renamed = await request(server)
        .patch(`/api/products/${product.id}`)
        .set(...auth(owner.accessToken))
        .send({ name: 'Mustard oil', unit: 'ml' })
        .expect(200);
      expect(productSchema.parse(renamed.body)).toMatchObject({
        name: 'Mustard oil',
        unitLocked: true,
      });
    });
  });

  describe('low stock', () => {
    it('flags products at or below their threshold and filters them', async () => {
      const owner = await registerOwner(server, 'inv-low');
      const low = await createProduct(owner.accessToken, {
        name: 'Lentils',
        lowStockThreshold: 1000,
      });
      const fine = await createProduct(owner.accessToken, {
        name: 'Sugar',
        lowStockThreshold: 1000,
      });
      await createProduct(owner.accessToken, { name: 'Salt' }); // no threshold: never low
      await stockIn(owner.accessToken, low.id, 1000).expect(201); // exactly at threshold
      await stockIn(owner.accessToken, fine.id, 1001).expect(201);

      const res = await request(server)
        .get('/api/products?lowStock=true')
        .set(...auth(owner.accessToken))
        .expect(200);
      const list = productListResponseSchema.parse(res.body);
      expect(list.items.map((p) => p.name)).toEqual(['Lentils']);
      expect(list.items[0]?.isLowStock).toBe(true);

      // Dropping Sugar to the threshold makes it low as well.
      const change = stockChangeResponseSchema.parse(
        (await adjust(owner.accessToken, fine.id, -1).expect(201)).body,
      );
      expect(change.isLowStock).toBe(true);
    });
  });

  describe('search and pagination', () => {
    it('searches name and SKU (substring, case-insensitive) and barcode (exact)', async () => {
      const owner = await registerOwner(server, 'inv-search');
      const category = categorySchema.parse(
        (
          await request(server)
            .post('/api/categories')
            .set(...auth(owner.accessToken))
            .send({ name: 'Oils' })
            .expect(201)
        ).body,
      );
      await createProduct(owner.accessToken, {
        name: 'Soybean Oil',
        sku: 'OIL-SOY-1L',
        unit: 'ml',
        categoryId: category.id,
      });
      await createProduct(owner.accessToken, {
        name: 'Mustard Oil',
        sku: 'OIL-MUS-1L',
        unit: 'ml',
        barcode: '8901234567890',
      });
      await createProduct(owner.accessToken, {
        name: '50% Discount Soap',
        sku: 'SOAP-50',
        unit: 'piece',
      });

      const names = async (query: string) =>
        productListResponseSchema
          .parse(
            (
              await request(server)
                .get(`/api/products?${query}`)
                .set(...auth(owner.accessToken))
            ).body,
          )
          .items.map((p) => p.name);

      expect(await names('search=oil')).toEqual(['Mustard Oil', 'Soybean Oil']);
      expect(await names('search=mus-1')).toEqual(['Mustard Oil']);
      expect(await names('search=8901234567890')).toEqual(['Mustard Oil']);
      expect(await names('search=890123')).toEqual([]); // barcode is exact, not substring
      expect(await names(`categoryId=${category.id}`)).toEqual(['Soybean Oil']);
      // Wildcards are literal: "%" matches only the soap, "_" matches nothing.
      expect(await names(`search=${encodeURIComponent('50%')}`)).toEqual(['50% Discount Soap']);
      expect(await names(`search=${encodeURIComponent('_')}`)).toEqual([]);
    });

    it('paginates with a stable order and a total', async () => {
      const owner = await registerOwner(server, 'inv-pages');
      for (let i = 1; i <= 7; i++) {
        await createProduct(owner.accessToken, { name: `Item ${String(i).padStart(2, '0')}` });
      }
      const page = async (n: number) =>
        productListResponseSchema.parse(
          (
            await request(server)
              .get(`/api/products?pageSize=3&page=${String(n)}`)
              .set(...auth(owner.accessToken))
          ).body,
        );
      const [p1, p2, p3, p4] = await Promise.all([page(1), page(2), page(3), page(4)]);
      expect([p1, p2, p3].map((p) => p.items.map((i) => i.name))).toEqual([
        ['Item 01', 'Item 02', 'Item 03'],
        ['Item 04', 'Item 05', 'Item 06'],
        ['Item 07'],
      ]);
      expect(p4.items).toEqual([]);
      expect(p1.total).toBe(7);
      expect(p4.total).toBe(7);
      await request(server)
        .get('/api/products?pageSize=101')
        .set(...auth(owner.accessToken))
        .expect(400);
    });
  });

  describe('role permissions', () => {
    it('managers manage products and stock; cashiers can only read', async () => {
      const owner = await registerOwner(server, 'inv-roles');
      const product = await createProduct(owner.accessToken);
      const manager = await staffToken(owner.accessToken, 'manager');
      const cashier = await staffToken(owner.accessToken, 'cashier');

      await createProduct(manager, { name: 'By manager' });
      await stockIn(manager, product.id, 100).expect(201);
      await adjust(manager, product.id, -10).expect(201);

      await request(server)
        .get('/api/products')
        .set(...auth(cashier))
        .expect(200);
      await request(server)
        .get(`/api/products/${product.id}/stock/movements`)
        .set(...auth(cashier))
        .expect(200);
      await request(server)
        .get('/api/categories')
        .set(...auth(cashier))
        .expect(200);
      await request(server)
        .post('/api/products')
        .set(...auth(cashier))
        .send({ name: 'X', sku: sku(), unit: 'piece', pricePoisha: 1, costPoisha: 1 })
        .expect(403);
      await request(server)
        .patch(`/api/products/${product.id}`)
        .set(...auth(cashier))
        .send({ name: 'X' })
        .expect(403);
      await stockIn(cashier, product.id, 1).expect(403);
      await adjust(cashier, product.id, -1).expect(403);
      await request(server)
        .post('/api/categories')
        .set(...auth(cashier))
        .send({ name: 'X' })
        .expect(403);
    });
  });

  describe('cross-tenant access', () => {
    it("never shows or changes another shop's products, stock or categories", async () => {
      const a = await registerOwner(server, 'inv-tenant-a');
      const b = await registerOwner(server, 'inv-tenant-b');
      const product = await createProduct(a.accessToken, { name: 'Shop A rice' });
      await stockIn(a.accessToken, product.id, 1000).expect(201);
      const categoryA = categorySchema.parse(
        (
          await request(server)
            .post('/api/categories')
            .set(...auth(a.accessToken))
            .send({ name: 'A only' })
        ).body,
      );

      const listB = productListResponseSchema.parse(
        (
          await request(server)
            .get('/api/products?includeArchived=true')
            .set(...auth(b.accessToken))
        ).body,
      );
      expect(listB.total).toBe(0);
      await request(server)
        .get(`/api/products/${product.id}`)
        .set(...auth(b.accessToken))
        .expect(404);
      await request(server)
        .patch(`/api/products/${product.id}`)
        .set(...auth(b.accessToken))
        .send({ pricePoisha: 1 })
        .expect(404);
      await stockIn(b.accessToken, product.id, 5).expect(404);
      await adjust(b.accessToken, product.id, -1000).expect(404);
      await request(server)
        .get(`/api/products/${product.id}/stock/movements`)
        .set(...auth(b.accessToken))
        .expect(404);
      const categoriesB = await request(server)
        .get('/api/categories')
        .set(...auth(b.accessToken));
      expect(categoriesB.body).toEqual({ items: [] });
      await request(server)
        .post('/api/products')
        .set(...auth(b.accessToken))
        .send({
          name: 'X',
          sku: sku(),
          unit: 'piece',
          pricePoisha: 1,
          costPoisha: 1,
          categoryId: categoryA.id,
        })
        .expect(404);

      const stillA = productSchema.parse(
        (
          await request(server)
            .get(`/api/products/${product.id}`)
            .set(...auth(a.accessToken))
        ).body,
      );
      expect(stillA).toMatchObject({ name: 'Shop A rice', stockQuantity: 1000, pricePoisha: 8500 });
    });
  });
});

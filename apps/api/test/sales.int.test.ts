import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import {
  apiErrorSchema,
  calculateSale,
  type Discount,
  type Product,
  productSchema,
  saleListResponseSchema,
  saleSchema,
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
 * Sales over HTTP against real Postgres: the stock check under locks, invoice
 * numbering, idempotency, voids, exact totals, role permissions and tenant isolation.
 */
describe('sales (integration)', () => {
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

  async function product(
    token: string,
    stock: number,
    overrides: Record<string, unknown> = {},
  ): Promise<Product> {
    const created = productSchema.parse(
      (
        await request(server)
          .post('/api/products')
          .set(...auth(token))
          .send({
            name: `Item ${randomUUID().slice(0, 6)}`,
            sku: `SKU-${randomUUID().slice(0, 8).toUpperCase()}`,
            unit: 'piece',
            pricePoisha: 4500,
            costPoisha: 3000,
            ...overrides,
          })
          .expect(201)
      ).body,
    );
    if (stock > 0) {
      await request(server)
        .post(`/api/products/${created.id}/stock/in`)
        .set(...auth(token))
        .set('idempotency-key', randomUUID())
        .send({ quantity: stock })
        .expect(201);
    }
    return created;
  }

  interface CartLine {
    product: Product;
    quantity: number;
    discount?: Discount | null;
  }

  /** The body the POS sends, with the expected total from the shared calculator. */
  function saleBody(lines: CartLine[], saleDiscount: Discount | null = null, tendered?: number) {
    const calc = calculateSale(
      lines.map((l) => ({
        unit: l.product.unit,
        quantity: l.quantity,
        unitPricePoisha: l.product.pricePoisha,
        vatRateBp: l.product.vatRateBp,
        discount: l.discount ?? null,
      })),
      saleDiscount,
    );
    if (!calc.ok) throw new Error(calc.error.kind);
    return {
      lines: lines.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        discount: l.discount ?? null,
      })),
      saleDiscount,
      payment: { method: 'cash', tenderedPoisha: tendered ?? calc.totals.totalPoisha },
      expectedTotalPoisha: calc.totals.totalPoisha,
    };
  }

  function sell(token: string, body: unknown, key: string = randomUUID()) {
    return request(server)
      .post('/api/sales')
      .set(...auth(token))
      .set('idempotency-key', key)
      .send(body as object);
  }

  async function stockOf(token: string, productId: string): Promise<number> {
    const res = await request(server)
      .get(`/api/products/${productId}`)
      .set(...auth(token))
      .expect(200);
    return productSchema.parse(res.body).stockQuantity;
  }

  async function staffToken(ownerToken: string, role: 'manager' | 'cashier'): Promise<string> {
    const temporaryPassword = `temp-${randomUUID()}`;
    const identifier = role === 'manager' ? uniqueEmail('sale-manager') : uniquePhone();
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

  describe('creating a sale', () => {
    it('records a mixed cart with exact totals, snapshots, cash change and stock movements', async () => {
      const owner = await registerOwner(server, 'sale-mixed');
      const rice = await product(owner.accessToken, 5000, {
        name: 'Miniket Rice',
        unit: 'gram',
        pricePoisha: 8550,
        vatRateBp: 750,
      });
      const soap = await product(owner.accessToken, 10, {
        name: 'Soap',
        pricePoisha: 4500,
        vatRateBp: 1500,
      });
      const oil = await product(owner.accessToken, 3000, {
        name: 'Oil',
        unit: 'ml',
        pricePoisha: 18000,
      });
      const body = saleBody(
        [
          { product: rice, quantity: 1500 },
          { product: soap, quantity: 3, discount: { type: 'percent', percentBp: 1000 } },
          { product: oil, quantity: 500, discount: { type: 'amount', amountPoisha: 250 } },
        ],
        { type: 'amount', amountPoisha: 1000 },
        50_000,
      );

      const res = await sell(owner.accessToken, body).expect(201);
      const sale = saleSchema.parse(res.body);

      expect(sale).toMatchObject({
        invoiceNo: 1,
        invoiceNumber: 'INV-000001',
        status: 'completed',
        shopName: owner.body.session.tenant.name,
        cashier: { id: owner.body.session.user.id },
        subtotalPoisha: 35325,
        lineDiscountPoisha: 1600,
        saleDiscountPoisha: 1000,
        discountPoisha: 2600,
        totalPoisha: 32725,
        paidPoisha: 32725,
        duePoisha: 0,
        void: null,
      });
      expect(sale.totalPoisha).toBe(body.expectedTotalPoisha);
      expect(sale.lines.reduce((a, l) => a + l.totalPoisha, 0)).toBe(sale.totalPoisha);
      expect(sale.lines.reduce((a, l) => a + l.taxPoisha, 0)).toBe(sale.taxPoisha);
      expect(sale.lines.reduce((a, l) => a + l.saleDiscountSharePoisha, 0)).toBe(1000);
      expect(sale.lines[0]).toMatchObject({
        productName: 'Miniket Rice',
        unit: 'gram',
        quantity: 1500,
        unitPricePoisha: 8550,
        grossPoisha: 12825,
        vatRateBp: 750,
      });
      expect(sale.payments).toEqual([
        { method: 'cash', amountPoisha: 32725, tenderedPoisha: 50_000, changePoisha: 17_275 },
      ]);

      expect(await stockOf(owner.accessToken, rice.id)).toBe(3500);
      expect(await stockOf(owner.accessToken, soap.id)).toBe(7);
      const history = stockMovementListResponseSchema.parse(
        (
          await request(server)
            .get(`/api/products/${rice.id}/stock/movements`)
            .set(...auth(owner.accessToken))
        ).body,
      );
      expect(history.items[0]).toMatchObject({
        type: 'sale',
        quantityDelta: -1500,
        quantityAfter: 3500,
      });
    });

    it('keeps the snapshot when the product changes later', async () => {
      const owner = await registerOwner(server, 'sale-snapshot');
      const item = await product(owner.accessToken, 5, { name: 'Old name', pricePoisha: 1000 });
      const sale = saleSchema.parse(
        (await sell(owner.accessToken, saleBody([{ product: item, quantity: 1 }])).expect(201))
          .body,
      );
      await request(server)
        .patch(`/api/products/${item.id}`)
        .set(...auth(owner.accessToken))
        .send({ name: 'New name', pricePoisha: 9999 })
        .expect(200);
      const again = saleSchema.parse(
        (
          await request(server)
            .get(`/api/sales/${sale.id}`)
            .set(...auth(owner.accessToken))
        ).body,
      );
      expect(again.lines[0]).toMatchObject({ productName: 'Old name', unitPricePoisha: 1000 });
    });

    it('refuses a total that differs from what the cashier saw, without using an invoice number', async () => {
      const owner = await registerOwner(server, 'sale-mismatch');
      const item = await product(owner.accessToken, 5);
      const body = { ...saleBody([{ product: item, quantity: 1 }]), expectedTotalPoisha: 4499 };
      const res = await sell(owner.accessToken, body).expect(409);
      expect(apiErrorSchema.parse(res.body).error).toMatchObject({ code: 'TOTAL_MISMATCH' });
      const next = saleSchema.parse(
        (await sell(owner.accessToken, saleBody([{ product: item, quantity: 1 }])).expect(201))
          .body,
      );
      expect(next.invoiceNo).toBe(1);
      expect(await stockOf(owner.accessToken, item.id)).toBe(4);
    });

    it('refuses short cash, oversized discounts, empty carts and a missing Idempotency-Key', async () => {
      const owner = await registerOwner(server, 'sale-invalid');
      const item = await product(owner.accessToken, 5);
      const short = await sell(
        owner.accessToken,
        saleBody([{ product: item, quantity: 1 }], null, 4499),
      ).expect(400);
      expect(apiErrorSchema.parse(short.body).error.issues?.[0]?.path).toBe(
        'payment.tenderedPoisha',
      );

      const tooMuch = saleBody([{ product: item, quantity: 1 }]);
      tooMuch.lines[0] = { ...tooMuch.lines[0]!, discount: { type: 'amount', amountPoisha: 4501 } };
      const res = await sell(owner.accessToken, tooMuch).expect(400);
      expect(apiErrorSchema.parse(res.body).error.issues?.[0]?.path).toBe('lines.0.discount');

      await sell(owner.accessToken, {
        ...saleBody([{ product: item, quantity: 1 }]),
        lines: [],
      }).expect(400);
      await request(server)
        .post('/api/sales')
        .set(...auth(owner.accessToken))
        .send(saleBody([{ product: item, quantity: 1 }]))
        .expect(400);
      expect(await stockOf(owner.accessToken, item.id)).toBe(5);
    });
  });

  describe('stock under concurrency', () => {
    it('sells the last unit exactly once, naming the product to the others', async () => {
      const owner = await registerOwner(server, 'sale-last-unit');
      const last = await product(owner.accessToken, 1, { name: 'Last Biscuit' });
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          sell(owner.accessToken, saleBody([{ product: last, quantity: 1 }])),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const refused = results.filter((r) => r.status === 409);
      expect(refused).toHaveLength(9);
      for (const r of refused) {
        expect(apiErrorSchema.parse(r.body).error).toMatchObject({
          code: 'INSUFFICIENT_STOCK',
          message: 'Not enough stock for "Last Biscuit"',
          issues: [{ path: 'lines.0.quantity', message: 'Not enough stock for "Last Biscuit"' }],
        });
      }
      expect(await stockOf(owner.accessToken, last.id)).toBe(0);
    });

    it('numbers concurrent sales sequentially with no duplicates or gaps', async () => {
      const owner = await registerOwner(server, 'sale-numbers');
      const item = await product(owner.accessToken, 100);
      const results = await Promise.all(
        Array.from({ length: 15 }, () =>
          sell(owner.accessToken, saleBody([{ product: item, quantity: 1 }])),
        ),
      );
      expect(results.map((r) => r.status)).toEqual(Array(15).fill(201));
      const numbers = results.map((r) => saleSchema.parse(r.body).invoiceNo).sort((a, b) => a - b);
      expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(await stockOf(owner.accessToken, item.id)).toBe(85);
    });
  });

  describe('idempotency', () => {
    it('returns the original sale for a retried key, and creates it only once', async () => {
      const owner = await registerOwner(server, 'sale-retry');
      const item = await product(owner.accessToken, 10);
      const body = saleBody([{ product: item, quantity: 2 }]);
      const key = randomUUID();

      const first = await sell(owner.accessToken, body, key).expect(201);
      const retry = await sell(owner.accessToken, body, key).expect(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(saleSchema.parse(retry.body).id).toBe(saleSchema.parse(first.body).id);

      // A double-click: five identical requests at once.
      const doubleKey = randomUUID();
      const burst = await Promise.all(
        Array.from({ length: 5 }, () => sell(owner.accessToken, body, doubleKey)),
      );
      const ids = new Set(burst.map((r) => saleSchema.parse(r.body).id));
      expect(ids.size).toBe(1);
      expect(burst.filter((r) => r.status === 201)).toHaveLength(1);

      const list = saleListResponseSchema.parse(
        (
          await request(server)
            .get('/api/sales')
            .set(...auth(owner.accessToken))
        ).body,
      );
      expect(list.total).toBe(2);
      expect(await stockOf(owner.accessToken, item.id)).toBe(6);
    });

    it('refuses the same key with a different body', async () => {
      const owner = await registerOwner(server, 'sale-key-reuse');
      const item = await product(owner.accessToken, 10);
      const key = randomUUID();
      await sell(owner.accessToken, saleBody([{ product: item, quantity: 1 }]), key).expect(201);
      const res = await sell(
        owner.accessToken,
        saleBody([{ product: item, quantity: 2 }]),
        key,
      ).expect(409);
      expect(apiErrorSchema.parse(res.body).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await stockOf(owner.accessToken, item.id)).toBe(9);
    });

    it('makes stock in and adjustments idempotent too', async () => {
      const owner = await registerOwner(server, 'stock-retry');
      const item = await product(owner.accessToken, 0);
      const inKey = randomUUID();
      const stockIn = () =>
        request(server)
          .post(`/api/products/${item.id}/stock/in`)
          .set(...auth(owner.accessToken))
          .set('idempotency-key', inKey)
          .send({ quantity: 10 });
      const results = await Promise.all([stockIn(), stockIn(), stockIn()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(await stockOf(owner.accessToken, item.id)).toBe(10);

      const adjKey = randomUUID();
      const adjust = (delta: number) =>
        request(server)
          .post(`/api/products/${item.id}/stock/adjustments`)
          .set(...auth(owner.accessToken))
          .set('idempotency-key', adjKey)
          .send({ delta, reason: 'Damaged' });
      await adjust(-3).expect(201);
      await adjust(-3).expect(200);
      const reused = await adjust(-4).expect(409);
      expect(apiErrorSchema.parse(reused.body).error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await stockOf(owner.accessToken, item.id)).toBe(7);

      await request(server)
        .post(`/api/products/${item.id}/stock/in`)
        .set(...auth(owner.accessToken))
        .send({ quantity: 1 })
        .expect(400);
    });

    it('scopes keys to the shop: the same key in two shops makes two sales', async () => {
      const a = await registerOwner(server, 'key-shop-a');
      const b = await registerOwner(server, 'key-shop-b');
      const itemA = await product(a.accessToken, 5);
      const itemB = await product(b.accessToken, 5);
      const key = randomUUID();
      const saleA = saleSchema.parse(
        (await sell(a.accessToken, saleBody([{ product: itemA, quantity: 1 }]), key).expect(201))
          .body,
      );
      const saleB = saleSchema.parse(
        (await sell(b.accessToken, saleBody([{ product: itemB, quantity: 1 }]), key).expect(201))
          .body,
      );
      expect(saleA.id).not.toBe(saleB.id);
    });
  });

  describe('voiding', () => {
    it('restores stock exactly once, keeps the sale and records who and why', async () => {
      const owner = await registerOwner(server, 'sale-void');
      const rice = await product(owner.accessToken, 5000, { unit: 'gram', pricePoisha: 10000 });
      const soap = await product(owner.accessToken, 10);
      const sale = saleSchema.parse(
        (
          await sell(
            owner.accessToken,
            saleBody([
              { product: rice, quantity: 1250 },
              { product: soap, quantity: 2 },
            ]),
          ).expect(201)
        ).body,
      );
      expect(await stockOf(owner.accessToken, rice.id)).toBe(3750);

      // Five concurrent voids: exactly one succeeds.
      const voids = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(server)
            .post(`/api/sales/${sale.id}/void`)
            .set(...auth(owner.accessToken))
            .send({ reason: 'Customer returned the goods' }),
        ),
      );
      expect(voids.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of voids.filter((v) => v.status !== 200)) {
        expect(r.status).toBe(409);
        expect(apiErrorSchema.parse(r.body).error.code).toBe('ALREADY_VOIDED');
      }

      expect(await stockOf(owner.accessToken, rice.id)).toBe(5000);
      expect(await stockOf(owner.accessToken, soap.id)).toBe(10);
      const voided = saleSchema.parse(
        (
          await request(server)
            .get(`/api/sales/${sale.id}`)
            .set(...auth(owner.accessToken))
        ).body,
      );
      expect(voided).toMatchObject({
        status: 'voided',
        totalPoisha: sale.totalPoisha,
        void: { by: { id: owner.body.session.user.id }, reason: 'Customer returned the goods' },
      });
      const history = stockMovementListResponseSchema.parse(
        (
          await request(server)
            .get(`/api/products/${rice.id}/stock/movements`)
            .set(...auth(owner.accessToken))
        ).body,
      );
      expect(history.items.filter((m) => m.type === 'sale_void')).toHaveLength(1);
      expect(history.items[0]).toMatchObject({
        type: 'sale_void',
        quantityDelta: 1250,
        quantityAfter: 5000,
      });
    });

    it('requires a reason', async () => {
      const owner = await registerOwner(server, 'void-reason');
      const item = await product(owner.accessToken, 5);
      const sale = saleSchema.parse(
        (await sell(owner.accessToken, saleBody([{ product: item, quantity: 1 }])).expect(201))
          .body,
      );
      await request(server)
        .post(`/api/sales/${sale.id}/void`)
        .set(...auth(owner.accessToken))
        .send({ reason: ' ' })
        .expect(400);
    });
  });

  describe('role permissions', () => {
    it('everyone can sell and read sales; only owners and managers can void', async () => {
      const owner = await registerOwner(server, 'sale-roles');
      const item = await product(owner.accessToken, 10);
      const cashier = await staffToken(owner.accessToken, 'cashier');
      const manager = await staffToken(owner.accessToken, 'manager');

      const byCashier = saleSchema.parse(
        (await sell(cashier, saleBody([{ product: item, quantity: 1 }])).expect(201)).body,
      );
      expect(byCashier.cashier.name).toBe('Cashier');
      await request(server)
        .get('/api/sales')
        .set(...auth(cashier))
        .expect(200);
      await request(server)
        .get(`/api/sales/${byCashier.id}`)
        .set(...auth(cashier))
        .expect(200);

      await request(server)
        .post(`/api/sales/${byCashier.id}/void`)
        .set(...auth(cashier))
        .send({ reason: 'Trying to void' })
        .expect(403);
      await request(server)
        .post(`/api/sales/${byCashier.id}/void`)
        .set(...auth(manager))
        .send({ reason: 'Wrong item scanned' })
        .expect(200);
      await sell(manager, saleBody([{ product: item, quantity: 1 }])).expect(201);
    });
  });

  describe('cross-tenant access', () => {
    it('never shows, voids or sells across shops', async () => {
      const a = await registerOwner(server, 'sale-tenant-a');
      const b = await registerOwner(server, 'sale-tenant-b');
      const itemA = await product(a.accessToken, 5);
      const saleA = saleSchema.parse(
        (await sell(a.accessToken, saleBody([{ product: itemA, quantity: 1 }])).expect(201)).body,
      );

      await request(server)
        .get(`/api/sales/${saleA.id}`)
        .set(...auth(b.accessToken))
        .expect(404);
      await request(server)
        .post(`/api/sales/${saleA.id}/void`)
        .set(...auth(b.accessToken))
        .send({ reason: 'Not mine' })
        .expect(404);
      const listB = saleListResponseSchema.parse(
        (
          await request(server)
            .get('/api/sales')
            .set(...auth(b.accessToken))
        ).body,
      );
      expect(listB.total).toBe(0);
      // Selling another shop's product: it does not exist for B.
      await sell(b.accessToken, saleBody([{ product: itemA, quantity: 1 }])).expect(404);

      const stillA = saleSchema.parse(
        (
          await request(server)
            .get(`/api/sales/${saleA.id}`)
            .set(...auth(a.accessToken))
        ).body,
      );
      expect(stillA.status).toBe('completed');
      expect(await stockOf(a.accessToken, itemA.id)).toBe(4);
    });
  });

  describe('sales list', () => {
    it('filters by date (Asia/Dhaka days), invoice number and status, with pagination', async () => {
      const owner = await registerOwner(server, 'sale-list');
      const item = await product(owner.accessToken, 50);
      const sales = [];
      for (let i = 0; i < 5; i++) {
        sales.push(
          saleSchema.parse(
            (await sell(owner.accessToken, saleBody([{ product: item, quantity: 1 }])).expect(201))
              .body,
          ),
        );
      }
      await request(server)
        .post(`/api/sales/${sales[1]!.id}/void`)
        .set(...auth(owner.accessToken))
        .send({ reason: 'Test void' })
        .expect(200);

      const list = async (query: string) =>
        saleListResponseSchema.parse(
          (
            await request(server)
              .get(`/api/sales?${query}`)
              .set(...auth(owner.accessToken))
              .expect(200)
          ).body,
        );
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
      const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(
        new Date(Date.now() - 24 * 60 * 60 * 1000),
      );

      const page1 = await list('pageSize=2');
      expect(page1.total).toBe(5);
      expect(page1.items.map((s) => s.invoiceNo)).toEqual([5, 4]); // newest first
      expect((await list('pageSize=2&page=3')).items.map((s) => s.invoiceNo)).toEqual([1]);
      expect((await list(`from=${today}&to=${today}`)).total).toBe(5);
      expect((await list(`to=${yesterday}`)).total).toBe(0);
      expect((await list('search=INV-000003')).items.map((s) => s.invoiceNo)).toEqual([3]);
      expect((await list('search=3')).items.map((s) => s.invoiceNo)).toEqual([3]);
      expect((await list('search=nonsense')).total).toBe(0);
      expect((await list('status=voided')).items.map((s) => s.invoiceNo)).toEqual([2]);
      await request(server)
        .get('/api/sales?from=27-11-2026')
        .set(...auth(owner.accessToken))
        .expect(400);
    });
  });
});

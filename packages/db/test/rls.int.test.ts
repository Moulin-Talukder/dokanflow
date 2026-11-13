import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, withDbContext, type PrismaClient } from '../src/index.js';
import { assertConnectedToTestDatabase } from '../src/testing.js';
import { testTargets } from './env.js';

/**
 * Raw database-level proof of tenant isolation. Runs as app_user (the runtime
 * role), with no application code in between.
 */

/** Tables that carry tenant_id but are deliberately global (see docs/SCHEMA.md). */
const GLOBAL_TABLES_WITH_TENANT_ID = new Set(['refresh_tokens']);

/** A random, valid normalized Bangladeshi mobile number. */
function randomPhone(): string {
  return `+88017${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

interface Seed {
  tenantId: string;
  branchId: string;
  ownerId: string;
}

describe('row level security', () => {
  let app: PrismaClient;
  /** A pool with a single connection, to prove settings do not leak between transactions. */
  let singleConnection: PrismaClient;
  let a: Seed;
  let b: Seed;
  /** A user who belongs to both shops (owner of A, cashier in B). */
  let sharedUserId: string;
  const run = randomUUID().slice(0, 8);

  async function seedTenant(label: string): Promise<Seed> {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const branchId = randomUUID();
    await app.user.create({
      data: {
        id: ownerId,
        name: `Owner ${label}`,
        email: `owner-${label}-${run}@test.local`,
        passwordHash: 'x',
      },
    });
    await app.tenant.create({ data: { id: tenantId, name: `Shop ${label} ${run}` } });
    await withDbContext(app, { tenantId, userId: ownerId }, async (tx) => {
      await tx.branch.create({ data: { id: branchId, tenantId, name: 'Main', isDefault: true } });
      await tx.membership.create({ data: { tenantId, userId: ownerId, role: 'owner' } });
    });
    return { tenantId, branchId, ownerId };
  }

  beforeAll(async () => {
    app = createPrismaClient({ connectionString: testTargets.databaseUrl, maxConnections: 4 });
    singleConnection = createPrismaClient({
      connectionString: testTargets.databaseUrl,
      maxConnections: 1,
    });
    await assertConnectedToTestDatabase(app);
    a = await seedTenant('a');
    b = await seedTenant('b');

    sharedUserId = randomUUID();
    await app.user.create({
      data: { id: sharedUserId, name: 'Shared', phone: randomPhone(), passwordHash: 'x' },
    });
    for (const [seed, role] of [
      [a, 'manager'],
      [b, 'cashier'],
    ] as const) {
      await withDbContext(app, { tenantId: seed.tenantId, userId: sharedUserId }, (tx) =>
        tx.membership.create({ data: { tenantId: seed.tenantId, userId: sharedUserId, role } }),
      );
    }
  });

  afterAll(async () => {
    // Clean up through the same RLS rules: each tenant's rows inside its own context.
    for (const seed of [a, b]) {
      await withDbContext(app, { tenantId: seed.tenantId, userId: null }, async (tx) => {
        await tx.membership.deleteMany({ where: { tenantId: seed.tenantId } });
        await tx.branch.deleteMany({ where: { tenantId: seed.tenantId } });
      });
    }
    await app.user.deleteMany({ where: { id: { in: [a.ownerId, b.ownerId, sharedUserId] } } });
    await app.tenant.deleteMany({ where: { id: { in: [a.tenantId, b.tenantId] } } });
    await Promise.all([app.$disconnect(), singleConnection.$disconnect()]);
  });

  it('enables and forces RLS, with a policy, on every table that has tenant_id', async () => {
    const rows = await app.$queryRaw<
      { table: string; rls: boolean; forced: boolean; policies: number }[]
    >`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute att ON att.attrelid = c.oid AND att.attname = 'tenant_id' AND NOT att.attisdropped
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname`;

    const scoped = rows.filter((r) => !GLOBAL_TABLES_WITH_TENANT_ID.has(r.table));
    expect(scoped.map((r) => r.table)).toEqual(expect.arrayContaining(['branches', 'memberships']));
    for (const row of scoped) {
      expect(row, `${row.table} must have RLS enabled, forced and a policy`).toMatchObject({
        rls: true,
        forced: true,
      });
      expect(row.policies, `${row.table} policies`).toBeGreaterThan(0);
    }
  });

  it('shows no tenant rows when no context is set', async () => {
    expect(await app.branch.count()).toBe(0);
    expect(await app.membership.count()).toBe(0);
  });

  it("shows only the current tenant's rows", async () => {
    const branches = await withDbContext(app, { tenantId: a.tenantId, userId: null }, (tx) =>
      tx.branch.findMany({ where: { tenantId: { in: [a.tenantId, b.tenantId] } } }),
    );
    expect(branches.map((br) => br.id)).toEqual([a.branchId]);
  });

  it("cannot find another tenant's row even by its id", async () => {
    const found = await withDbContext(app, { tenantId: a.tenantId, userId: null }, (tx) =>
      tx.branch.findUnique({ where: { id: b.branchId } }),
    );
    expect(found).toBeNull();
  });

  it('rejects inserting a row into another tenant', async () => {
    await expect(
      withDbContext(app, { tenantId: a.tenantId, userId: a.ownerId }, (tx) =>
        tx.branch.create({ data: { tenantId: b.tenantId, name: 'Sneaky' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const result = await withDbContext(app, { tenantId: a.tenantId, userId: null }, async (tx) => ({
      updated: await tx.branch.updateMany({ where: { id: b.branchId }, data: { name: 'Hacked' } }),
      deleted: await tx.membership.deleteMany({ where: { tenantId: b.tenantId } }),
    }));
    expect(result.updated.count).toBe(0);
    expect(result.deleted.count).toBe(0);

    const stillThere = await withDbContext(app, { tenantId: b.tenantId, userId: null }, (tx) =>
      tx.branch.findUnique({ where: { id: b.branchId } }),
    );
    expect(stillThere?.name).toBe('Main');
  });

  it("lets a user read their own memberships in every shop, but not other people's", async () => {
    const visible = await withDbContext(app, { tenantId: a.tenantId, userId: sharedUserId }, (tx) =>
      tx.membership.findMany({ where: { tenantId: { in: [a.tenantId, b.tenantId] } } }),
    );
    const mine = visible.filter((m) => m.userId === sharedUserId);
    expect(mine.map((m) => m.tenantId).sort()).toEqual([a.tenantId, b.tenantId].sort());
    // Tenant B's owner is visible to nobody acting in tenant A.
    expect(visible.some((m) => m.userId === b.ownerId)).toBe(false);
  });

  it('does not let the self-read policy be used to write into another shop', async () => {
    await expect(
      withDbContext(app, { tenantId: null, userId: sharedUserId }, (tx) =>
        tx.membership.create({ data: { tenantId: b.tenantId, userId: a.ownerId, role: 'owner' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('does not leak the context to the next transaction on the same connection', async () => {
    const inside = await withDbContext(
      singleConnection,
      { tenantId: a.tenantId, userId: null },
      (tx) => tx.branch.count(),
    );
    const after = await singleConnection.branch.count();
    expect(inside).toBeGreaterThan(0);
    expect(after).toBe(0);
  });

  it('allows only one default branch per tenant, and never is_default = false', async () => {
    await expect(
      withDbContext(app, { tenantId: a.tenantId, userId: null }, (tx) =>
        tx.branch.create({ data: { tenantId: a.tenantId, name: 'Second', isDefault: true } }),
      ),
    ).rejects.toThrow(/unique/i);
    await expect(
      withDbContext(app, { tenantId: a.tenantId, userId: null }, (tx) =>
        tx.branch.create({ data: { tenantId: a.tenantId, name: 'Odd', isDefault: false } }),
      ),
    ).rejects.toThrow(/branches_is_default_true_or_null|check/i);
  });

  it('enforces normalized identifiers on users', async () => {
    await expect(
      app.user.create({ data: { name: 'Bad', email: 'Mixed@Case.test', passwordHash: 'x' } }),
    ).rejects.toThrow(/users_email_normalized|check/i);
    await expect(
      app.user.create({ data: { name: 'Bad', phone: '01712345678', passwordHash: 'x' } }),
    ).rejects.toThrow(/users_phone_normalized|check/i);
    await expect(app.user.create({ data: { name: 'Bad', passwordHash: 'x' } })).rejects.toThrow(
      /users_identifier_present|check/i,
    );
  });
});

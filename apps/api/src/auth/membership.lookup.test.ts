import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../infra/prisma.service.js';
import { MembershipLookup } from './membership.lookup.js';

const USER = randomUUID();
const TENANT = randomUUID();
const SESSION = randomUUID();

/** Records the RLS context withDbContext sets, and answers the two lookups. */
function fakePrisma(session: { userId: string; expiresAt: Date; revokedAt: Date | null } | null) {
  const contexts: unknown[][] = [];
  const membership = {
    role: 'manager',
    user: { mustChangePassword: false, status: 'active' },
    tenant: { status: 'active' },
  };
  const tx = {
    $executeRaw: vi.fn((_s: TemplateStringsArray, ...values: unknown[]) => {
      contexts.push(values);
      return Promise.resolve(1);
    }),
    authSession: { findUnique: vi.fn(() => Promise.resolve(session)) },
    membership: {
      findUnique: vi.fn(() => Promise.resolve(membership)),
      findFirst: vi.fn(() => Promise.resolve(membership)),
    },
  };
  const client = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { prisma: { client } as unknown as PrismaService, contexts, tx };
}

describe('MembershipLookup', () => {
  it('findOwn checks membership with the user context only, never the requested shop', async () => {
    const { prisma, contexts, tx } = fakePrisma(null);
    const result = await new MembershipLookup(prisma).findOwn(USER, TENANT);

    expect(result?.role).toBe('manager');
    // set_config('app.tenant_id', '', true), set_config('app.user_id', USER, true)
    expect(contexts).toEqual([['', USER]]);
    expect(tx.membership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER, tenantId: TENANT } }),
    );
  });

  it('forAccessToken reports an active session', async () => {
    const { prisma, contexts } = fakePrisma({
      userId: USER,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    const result = await new MembershipLookup(prisma).forAccessToken({
      sub: USER,
      tid: TENANT,
      sid: SESSION,
    });
    expect(result?.sessionActive).toBe(true);
    // The signed token's tenant is the RLS context here.
    expect(contexts).toEqual([[TENANT, USER]]);
  });

  it.each([
    ['revoked', { userId: USER, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() }],
    ['expired', { userId: USER, expiresAt: new Date(Date.now() - 1), revokedAt: null }],
    [
      "another user's",
      { userId: randomUUID(), expiresAt: new Date(Date.now() + 60_000), revokedAt: null },
    ],
    ['missing', null],
  ])('forAccessToken reports a %s session as inactive', async (_label, session) => {
    const { prisma } = fakePrisma(session);
    const result = await new MembershipLookup(prisma).forAccessToken({
      sub: USER,
      tid: TENANT,
      sid: SESSION,
    });
    expect(result?.sessionActive).toBe(false);
  });
});

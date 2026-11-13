import { describe, expect, it, vi } from 'vitest';
import { InvalidDbContextError, withDbContext } from './context.js';
import type { PrismaClient } from './generated/prisma/client.js';

const TENANT = '0b6f1c8e-9a1d-4a53-8f0e-5e2b4d3c2a10';
const USER = '6a1d2c3b-4e5f-4a7b-8c9d-0e1f2a3b4c5d';

/** Records what withDbContext sends to the transaction client. */
function fakeClient() {
  const statements: { sql: string; values: unknown[] }[] = [];
  const tx = {
    $executeRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push({ sql: strings.join('?'), values });
      return Promise.resolve(1);
    }),
  };
  const client = {
    $transaction: vi.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { client: client as unknown as PrismaClient, statements, tx };
}

describe('withDbContext', () => {
  it('sets both settings transaction-locally before running the callback', async () => {
    const { client, statements, tx } = fakeClient();
    const order: string[] = [];
    tx.$executeRaw.mockImplementationOnce((strings: TemplateStringsArray, ...values: unknown[]) => {
      order.push('set_config');
      statements.push({ sql: strings.join('?'), values });
      return Promise.resolve(1);
    });

    const result = await withDbContext(client, { tenantId: TENANT, userId: USER }, () => {
      order.push('callback');
      return Promise.resolve('done');
    });

    expect(result).toBe('done');
    expect(order).toEqual(['set_config', 'callback']);
    expect(statements[0]?.sql).toContain("set_config('app.tenant_id', ?, true)");
    expect(statements[0]?.sql).toContain("set_config('app.user_id', ?, true)");
    expect(statements[0]?.values).toEqual([TENANT, USER]);
  });

  it('passes empty strings for missing context, which RLS treats as no access', async () => {
    const { client, statements } = fakeClient();
    await withDbContext(client, { tenantId: null, userId: null }, () => Promise.resolve());
    expect(statements[0]?.values).toEqual(['', '']);
  });

  it.each([
    [{ tenantId: "x'; DROP TABLE users; --", userId: null }],
    [{ tenantId: null, userId: 'not-a-uuid' }],
  ])('rejects non-UUID context before opening a transaction (%j)', async (context) => {
    const { client } = fakeClient();
    await expect(withDbContext(client, context, () => Promise.resolve())).rejects.toBeInstanceOf(
      InvalidDbContextError,
    );
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

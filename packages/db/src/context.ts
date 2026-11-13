import type { Prisma, PrismaClient } from './generated/prisma/client.js';

/** A Prisma client bound to one interactive transaction. */
export type TransactionClient = Prisma.TransactionClient;

/**
 * The RLS context for a transaction. `tenantId` scopes tenant-owned rows;
 * `userId` additionally lets a user read their own memberships in other shops.
 */
export interface DbContext {
  tenantId: string | null;
  userId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidDbContextError extends Error {
  constructor(field: keyof DbContext) {
    super(`${field} must be a UUID or null`);
    this.name = 'InvalidDbContextError';
  }
}

function assertUuidOrNull(value: string | null, field: keyof DbContext): void {
  if (value !== null && !UUID.test(value)) {
    throw new InvalidDbContextError(field);
  }
}

export interface WithDbContextOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Max time the whole transaction may take, in ms (Prisma default: 5000). */
  timeout?: number;
}

/**
 * Runs `fn` in one transaction whose first statement sets the RLS context with
 * set_config(..., true). The settings are transaction-local, so they can never
 * leak to another request through the connection pool. All tenant-scoped queries
 * must go through this function; without it, RLS hides every tenant row.
 */
export async function withDbContext<T>(
  client: PrismaClient,
  context: DbContext,
  fn: (tx: TransactionClient) => Promise<T>,
  options: WithDbContextOptions = {},
): Promise<T> {
  assertUuidOrNull(context.tenantId, 'tenantId');
  assertUuidOrNull(context.userId, 'userId');

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT set_config('app.tenant_id', ${context.tenantId ?? ''}, true),
             set_config('app.user_id', ${context.userId ?? ''}, true)`;
    return fn(tx);
  }, options);
}

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { Prisma, PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  /** Postgres connection string. Runtime services must connect as app_user, not the schema owner. */
  connectionString: string;
  /** Maximum connections in this process's pool. */
  maxConnections?: number;
  /** Fail a connection attempt after this many milliseconds. node-postgres defaults to never. */
  connectionTimeoutMs?: number;
  /** Shown in pg_stat_activity, which helps when debugging locks and slow queries. */
  applicationName?: string;
}

/**
 * Creates a Prisma client backed by the node-postgres driver adapter.
 * Callers own the client's lifecycle and must call `$disconnect()` on shutdown.
 */
export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    application_name: options.applicationName ?? 'dokanflow',
  });
  return new PrismaClient({ adapter });
}

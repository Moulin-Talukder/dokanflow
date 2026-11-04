import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@dokanflow/db';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';

interface RuntimeRoleRow {
  role: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/**
 * Owns the API's Prisma client. Tenant-scoped query helpers (RLS context) are
 * added in Phase 2. Feature code must go through them, not `client` directly.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: ApiEnv) {
    this.client = createPrismaClient({
      connectionString: config.DATABASE_URL,
      applicationName: 'dokanflow-api',
    });
  }

  /**
   * Refuses to start if the runtime role could bypass Row Level Security.
   * Connecting as a superuser or the schema owner would silently disable tenant isolation.
   */
  async onModuleInit(): Promise<void> {
    let row: RuntimeRoleRow | undefined;
    try {
      [row] = await this.client.$queryRaw<RuntimeRoleRow[]>`
        SELECT current_user AS role, rolsuper, rolbypassrls
        FROM pg_roles WHERE rolname = current_user`;
    } catch (error) {
      throw new Error(
        'Could not connect to Postgres using DATABASE_URL. Is it running and migrated? ' +
          '(Locally: pnpm infra:up && pnpm db:deploy)',
        { cause: error },
      );
    }
    if (!row) {
      throw new Error('Could not read the database role of the runtime connection');
    }
    if (row.rolsuper || row.rolbypassrls) {
      throw new Error(
        `DATABASE_URL connects as "${row.role}", which bypasses Row Level Security. ` +
          'Use the app_user role (see infra/postgres/bootstrap.sql).',
      );
    }
    this.logger.log(`Connected to Postgres as ${row.role}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }
}

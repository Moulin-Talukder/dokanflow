import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../src/index.js';
import { assertConnectedToTestDatabase } from '../src/testing.js';
import { testTargets } from './env.js';

interface RoleRow {
  current_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcreaterole: boolean;
}

/**
 * The runtime role must be unable to bypass Row Level Security or change the schema.
 * Later phases rely on these guarantees for tenant isolation.
 */
describe('database roles', () => {
  let app: PrismaClient;
  let owner: PrismaClient;

  beforeAll(async () => {
    app = createPrismaClient({ connectionString: testTargets.databaseUrl, maxConnections: 2 });
    owner = createPrismaClient({
      connectionString: testTargets.migrationDatabaseUrl,
      maxConnections: 2,
    });
    await assertConnectedToTestDatabase(app);
    await assertConnectedToTestDatabase(owner);
  });

  afterAll(async () => {
    await Promise.all([app.$disconnect(), owner.$disconnect()]);
  });

  it('runs the application as a role that cannot bypass RLS', async () => {
    const [role] = await app.$queryRaw<RoleRow[]>`
      SELECT current_user, r.rolsuper, r.rolbypassrls, r.rolcreaterole
      FROM pg_roles r WHERE r.rolname = current_user`;

    expect(role).toEqual({
      current_user: 'app_user',
      rolsuper: false,
      rolbypassrls: false,
      rolcreaterole: false,
    });
  });

  it('uses different roles for the application and migrations', async () => {
    const [ownerRole] = await owner.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(ownerRole?.current_user).not.toBe('app_user');
  });

  it('prevents the application role from creating tables', async () => {
    await expect(
      app.$executeRawUnsafe('CREATE TABLE public.should_not_exist (id int)'),
    ).rejects.toThrow(/permission denied/i);
  });

  it('gives the application role DML (but not DDL) on tables created by migrations', async () => {
    // Simulates a table created by a future migration: owned by the migration role.
    const table = `privilege_probe_${randomUUID().replaceAll('-', '')}`;
    await owner.$executeRawUnsafe(`CREATE TABLE public.${table} (id int PRIMARY KEY)`);
    try {
      await app.$executeRawUnsafe(`INSERT INTO public.${table} (id) VALUES (1)`);
      const rows = await app.$queryRawUnsafe<{ id: number }[]>(`SELECT id FROM public.${table}`);
      expect(rows).toEqual([{ id: 1 }]);

      await expect(app.$executeRawUnsafe(`TRUNCATE public.${table}`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(app.$executeRawUnsafe(`DROP TABLE public.${table}`)).rejects.toThrow(
        /must be owner/i,
      );
    } finally {
      await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS public.${table}`);
    }
  });
});

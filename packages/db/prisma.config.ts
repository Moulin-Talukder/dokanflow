import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env files. Load the repo-root .env for local development;
// CI and production provide real environment variables instead.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

/**
 * PRISMA_TARGET=test (used by `pnpm db:test:deploy`) migrates the integration-test
 * database instead. It must be a database whose name ends in "_test".
 */
function migrationUrl(): string {
  if (process.env.PRISMA_TARGET !== 'test') {
    // `prisma generate` does not connect, so an unset URL is allowed for it.
    return process.env.MIGRATION_DATABASE_URL ?? '';
  }
  const url = process.env.TEST_MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error('PRISMA_TARGET=test requires TEST_MIGRATION_DATABASE_URL');
  }
  const database = new URL(url).pathname.replace(/^\//, '');
  if (!database.endsWith('_test')) {
    throw new Error(`PRISMA_TARGET=test refuses database "${database}" (name must end in "_test")`);
  }
  return url;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // The CLI (migrate, db execute) connects as the schema owner, never as app_user.
    url: migrationUrl(),
  },
});

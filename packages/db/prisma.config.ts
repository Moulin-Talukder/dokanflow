import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load .env files. Load the repo-root .env for local development;
// CI and production provide real environment variables instead.
const rootEnvFile = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // The CLI (migrate, db execute) connects as the schema owner, never as app_user.
    // `prisma generate` does not connect, so an unset URL is allowed for it.
    url: process.env.MIGRATION_DATABASE_URL ?? '',
  },
});

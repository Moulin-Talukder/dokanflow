import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveIntegrationTestTargets } from '../src/testing.js';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

/**
 * Integration tests use only the TEST_* database. This throws before any
 * connection is opened if the settings could reach the development database.
 */
export const testTargets = resolveIntegrationTestTargets(process.env);

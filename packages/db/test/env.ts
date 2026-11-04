import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} must be set to run integration tests (see .env.example)`);
  }
  return value;
}

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Loads the repo-root .env file for local development, if it exists.
 * Variables already set in the environment win. Production provides real
 * environment variables and has no .env file, so this is a no-op there.
 */
export function loadRootEnvFile(): void {
  // Both src/config and dist/config sit three levels below the repo root.
  const file = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

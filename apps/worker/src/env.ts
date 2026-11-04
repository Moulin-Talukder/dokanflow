import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

/** Validates environment variables. Messages name variables but never echo values. */
export function parseWorkerEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}

/** Loads the repo-root .env for local development. No-op when the file is absent. */
export function loadRootEnvFile(): void {
  // Resolves from apps/worker/src or apps/worker/dist to the repo root.
  const file = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

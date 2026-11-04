import { z } from 'zod';

const originSchema = z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin);

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  /** Comma-separated list of allowed browser origins. Empty means no cross-origin access. */
  API_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(originSchema)),
  /** Runtime connection. Must use the app_user role, never the schema owner. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates environment variables at boot. Error messages name the variable and the
 * problem but never echo values, which may be secrets.
 */
export function parseApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const result = apiEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

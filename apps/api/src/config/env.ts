import { z } from 'zod';

const originSchema = z.url({ protocol: /^https?$/ }).transform((value) => new URL(value).origin);

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const apiEnvObjectSchema = z.object({
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

  /** HMAC key for access tokens (HS256). At least 32 characters of random data. */
  JWT_ACCESS_SECRET: z.string().min(32, 'Must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  /** Defaults to true in production and false elsewhere (http://localhost). */
  AUTH_COOKIE_SECURE: booleanString.optional(),
  /**
   * strict: web and API on the same site (e.g. app.example.com + api.example.com,
   * or localhost:3000 + localhost:4000). none: different sites; requires Secure.
   */
  AUTH_COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  /** Optional cookie Domain. Leave unset to scope the cookie to the API host only. */
  AUTH_COOKIE_DOMAIN: z.string().trim().min(1).optional(),
});

/** Insecure combinations are rejected at boot rather than discovered in a browser. */
export const apiEnvSchema = apiEnvObjectSchema
  .transform((env) => ({
    ...env,
    AUTH_COOKIE_SECURE: env.AUTH_COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'Must be true in production',
      });
    }
    if (env.AUTH_COOKIE_SAMESITE === 'none' && !env.AUTH_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SAMESITE'],
        message: 'SameSite=None requires AUTH_COOKIE_SECURE=true',
      });
    }
    if (env.NODE_ENV === 'production' && env.API_CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_CORS_ORIGINS'],
        message: 'Must list the web app origin in production (needed for CSRF checks)',
      });
    }
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

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

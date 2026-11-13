import { type ApiEnv, parseApiEnv } from '../config/env.js';

/** A valid environment for unit tests. Nothing here connects anywhere. */
export function testEnv(overrides: Record<string, string> = {}): ApiEnv {
  return parseApiEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://app_user:x@127.0.0.1:1/unit',
    REDIS_URL: 'redis://127.0.0.1:1',
    JWT_ACCESS_SECRET: 'Yv7Qk2Lp9Xr4Tn8Bw1Hc6Md3Fz5Sg0Ja7Ue2Ko9Ri4Wt6Nb',
    API_CORS_ORIGINS: 'http://localhost:3000',
    ...overrides,
  });
}

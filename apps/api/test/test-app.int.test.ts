import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refreshCookieConfig } from '../src/auth/refresh-cookie.js';
import { createTestApp, type TestApp } from './helpers.js';

/**
 * The integration-test app must not depend on the developer's .env or shell. Set
 * hostile values in process.env and check createTestApp() ignores them.
 */
describe('createTestApp configuration', () => {
  const hostile: Record<string, string> = {
    RATE_LIMIT_SCALE: '1',
    RATE_LIMIT_KEY_PREFIX: 'rl',
    AUTH_COOKIE_SAMESITE: 'none',
    AUTH_COOKIE_SECURE: 'true',
    AUTH_COOKIE_DOMAIN: 'dev.example',
    JWT_ACCESS_TTL_SECONDS: '60',
    PASSWORD_HASH_CONCURRENCY: '1',
    API_CORS_ORIGINS: 'https://somewhere-else.example',
    DATABASE_URL: 'postgresql://app_user:x@localhost:5432/dokanflow',
    REDIS_URL: 'redis://localhost:6379/0',
  };
  const saved: Record<string, string | undefined> = {};
  let testApp: TestApp;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(hostile)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  });

  it('ignores environment values for every app setting', () => {
    const { env } = testApp;
    expect(env.RATE_LIMIT_SCALE).toBe(1000);
    expect(env.RATE_LIMIT_KEY_PREFIX).toMatch(/^rl-test-[0-9a-f]{8}$/);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.PASSWORD_HASH_CONCURRENCY).toBe(4);
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.AUTH_COOKIE_DOMAIN).toBeUndefined();
    expect(refreshCookieConfig(env)).toMatchObject({
      name: 'dokanflow_rt',
      options: { sameSite: 'strict', secure: false, path: '/' },
    });
  });

  it('only ever uses the guarded TEST_* database and Redis', () => {
    expect(testApp.env.DATABASE_URL).toBe(process.env.TEST_DATABASE_URL);
    expect(testApp.env.REDIS_URL).toBe(process.env.TEST_REDIS_URL);
    expect(testApp.env.NODE_ENV).toBe('test');
  });

  it('gives each app its own rate-limit key prefix', async () => {
    const other = await createTestApp();
    try {
      expect(other.env.RATE_LIMIT_KEY_PREFIX).not.toBe(testApp.env.RATE_LIMIT_KEY_PREFIX);
    } finally {
      await other.app.close();
    }
  });
});

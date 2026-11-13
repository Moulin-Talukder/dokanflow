import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseApiEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://app_user:secret@localhost:5432/dokanflow',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
};

describe('parseApiEnv', () => {
  it('applies defaults', () => {
    const env = parseApiEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 4000,
      API_CORS_ORIGINS: [],
      JWT_ACCESS_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 14,
      SESSION_MAX_AGE_DAYS: 30,
      PASSWORD_HASH_CONCURRENCY: 4,
      PASSWORD_HASH_QUEUE: 32,
      RATE_LIMIT_SCALE: 1,
      AUTH_COOKIE_SECURE: false,
      AUTH_COOKIE_SAMESITE: 'strict',
    });
  });

  it('coerces the port and normalizes CORS origins', () => {
    const env = parseApiEnv({
      ...valid,
      API_PORT: '8080',
      API_CORS_ORIGINS: ' http://localhost:3000 , https://app.example.com/ ,',
    });
    expect(env.API_PORT).toBe(8080);
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.example.com']);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseApiEnv({ REDIS_URL: valid.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => parseApiEnv({ ...valid, DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(
      EnvValidationError,
    );
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseApiEnv({ ...valid, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('rejects a CORS origin that is not an http(s) URL', () => {
    expect(() => parseApiEnv({ ...valid, API_CORS_ORIGINS: 'javascript:alert(1)' })).toThrow(
      /API_CORS_ORIGINS/,
    );
  });

  it('never echoes secret values in the error message', () => {
    const secret = 'super-secret-password';
    try {
      parseApiEnv({ DATABASE_URL: `mysql://user:${secret}@host/db`, REDIS_URL: 'nope' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(String(error)).not.toContain(secret);
    }
  });

  it('requires a JWT secret of at least 32 characters', () => {
    expect(() => parseApiEnv({ ...valid, JWT_ACCESS_SECRET: undefined })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
    expect(() => parseApiEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  describe('auth cookie settings', () => {
    const production = {
      ...valid,
      JWT_ACCESS_SECRET: 'kQ3v9Zs1Lr8XbN2wTe5YpHc7Ud0Mg4Ja6Fi1Ow8Rx3Vt5Bn9Ky2Lq7Pz0Sm4Gh6D',
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'https://app.example.com',
    };

    it('defaults Secure to true in production and false in development', () => {
      expect(parseApiEnv(production).AUTH_COOKIE_SECURE).toBe(true);
      expect(parseApiEnv(valid).AUTH_COOKIE_SECURE).toBe(false);
    });

    it('refuses to start in production with Secure turned off', () => {
      expect(() => parseApiEnv({ ...production, AUTH_COOKIE_SECURE: 'false' })).toThrow(
        /AUTH_COOKIE_SECURE: Must be true in production/,
      );
    });

    it('refuses SameSite=None without Secure', () => {
      expect(() => parseApiEnv({ ...valid, AUTH_COOKIE_SAMESITE: 'none' })).toThrow(
        /SameSite=None requires/,
      );
      expect(
        parseApiEnv({ ...valid, AUTH_COOKIE_SAMESITE: 'none', AUTH_COOKIE_SECURE: 'true' })
          .AUTH_COOKIE_SAMESITE,
      ).toBe('none');
    });

    it('requires an explicit web origin in production', () => {
      expect(() => parseApiEnv({ ...production, API_CORS_ORIGINS: '' })).toThrow(
        /API_CORS_ORIGINS/,
      );
    });

    it('rejects values that are not exactly true or false', () => {
      expect(() => parseApiEnv({ ...valid, AUTH_COOKIE_SECURE: 'yes' })).toThrow(
        /AUTH_COOKIE_SECURE/,
      );
    });
  });

  describe('JWT secret strength in production', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'https://app.example.com',
    };

    it('refuses to start with the .env.example secret', () => {
      expect(() =>
        parseApiEnv({
          ...production,
          JWT_ACCESS_SECRET: 'local-only-change-me-0123456789abcdefghijklmnop',
        }),
      ).toThrow(/JWT_ACCESS_SECRET: looks like a placeholder/);
    });

    it('refuses a long but low-entropy secret', () => {
      expect(() => parseApiEnv({ ...production, JWT_ACCESS_SECRET: 'x'.repeat(64) })).toThrow(
        /JWT_ACCESS_SECRET: too little entropy/,
      );
    });

    it('allows the placeholder outside production', () => {
      expect(() =>
        parseApiEnv({
          ...valid,
          JWT_ACCESS_SECRET: 'local-only-change-me-0123456789abcdefghijklmnop',
        }),
      ).not.toThrow();
    });

    it('refuses a scaled-up rate limit in production', () => {
      expect(() =>
        parseApiEnv({
          ...production,
          JWT_ACCESS_SECRET: 'kQ3v9Zs1Lr8XbN2wTe5YpHc7Ud0Mg4Ja6Fi1Ow8Rx3Vt5Bn9Ky2Lq7Pz0Sm4Gh6D',
          RATE_LIMIT_SCALE: '100',
        }),
      ).toThrow(/RATE_LIMIT_SCALE/);
    });
  });
});

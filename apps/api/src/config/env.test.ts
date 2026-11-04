import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseApiEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgresql://app_user:secret@localhost:5432/dokanflow',
  REDIS_URL: 'redis://localhost:6379',
};

describe('parseApiEnv', () => {
  it('applies defaults', () => {
    const env = parseApiEnv(valid);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 4000,
      API_CORS_ORIGINS: [],
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
});

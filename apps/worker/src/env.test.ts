import { describe, expect, it } from 'vitest';
import { parseWorkerEnv } from './env.js';

describe('parseWorkerEnv', () => {
  it('applies defaults', () => {
    expect(parseWorkerEnv({ REDIS_URL: 'redis://localhost:6379' })).toEqual({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      REDIS_URL: 'redis://localhost:6379',
      WORKER_CONCURRENCY: 5,
    });
  });

  it('accepts TLS redis URLs and coerces concurrency', () => {
    const env = parseWorkerEnv({ REDIS_URL: 'rediss://cache:6380', WORKER_CONCURRENCY: '10' });
    expect(env.WORKER_CONCURRENCY).toBe(10);
  });

  it('rejects a missing or non-redis URL', () => {
    expect(() => parseWorkerEnv({})).toThrow(/REDIS_URL/);
    expect(() => parseWorkerEnv({ REDIS_URL: 'http://localhost' })).toThrow(/REDIS_URL/);
  });

  it('rejects out-of-range concurrency', () => {
    expect(() =>
      parseWorkerEnv({ REDIS_URL: 'redis://localhost:6379', WORKER_CONCURRENCY: '0' }),
    ).toThrow(/WORKER_CONCURRENCY/);
  });
});

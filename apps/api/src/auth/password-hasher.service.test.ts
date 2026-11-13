import { describe, expect, it, vi } from 'vitest';
import { ApiHttpException } from '../common/api-http.exception.js';
import * as hasher from './password-hasher.js';
import { PasswordHasher } from './password-hasher.service.js';
import { testEnv } from './test-env.js';

describe('PasswordHasher', () => {
  it('computes the decoy hash at startup, not on the first unknown-user login', async () => {
    const spy = vi.spyOn(hasher, 'getDummyPasswordHash');
    const service = new PasswordHasher(testEnv());
    await service.onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await service.verifyDummy('anything')).toBe(false);
    spy.mockRestore();
  });

  it('caps concurrent hashing and answers 503 when the queue is full', async () => {
    const service = new PasswordHasher(
      testEnv({ PASSWORD_HASH_CONCURRENCY: '1', PASSWORD_HASH_QUEUE: '1' }),
    );
    const running = service.hash('first-password');
    const queued = service.hash('second-password');
    const rejected = service.hash('third-password');

    await expect(rejected).rejects.toBeInstanceOf(ApiHttpException);
    await expect(rejected).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(await hasher.verifyPassword('first-password', await running)).toBe(true);
    expect(await hasher.verifyPassword('second-password', await queued)).toBe(true);
  });
});

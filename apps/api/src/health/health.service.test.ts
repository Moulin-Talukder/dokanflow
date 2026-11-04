import { Test } from '@nestjs/testing';
import { readinessResponseSchema } from '@dokanflow/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { DEPENDENCY_TIMEOUT_MS, HealthService } from './health.service.js';

async function createService(
  databasePing: () => Promise<void>,
  redisPing: () => Promise<void>,
): Promise<HealthService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      HealthService,
      { provide: PrismaService, useValue: { ping: databasePing } },
      { provide: RedisService, useValue: { ping: redisPing } },
    ],
  }).compile();
  return moduleRef.get(HealthService);
}

const ok = (): Promise<void> => Promise.resolve();

describe('HealthService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports ok when every dependency is up', async () => {
    const service = await createService(ok, ok);
    const result = await service.readiness();

    expect(result.status).toBe('ok');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(readinessResponseSchema.safeParse(result).success).toBe(true);
  });

  it('reports error, without leaking the cause, when a dependency fails', async () => {
    const service = await createService(
      () => Promise.reject(new Error('connect ECONNREFUSED postgres://app_user:secret@db')),
      ok,
    );
    const result = await service.readiness();

    expect(result.status).toBe('error');
    expect(result.checks.database).toMatchObject({ status: 'down', error: 'unavailable' });
    expect(result.checks.redis.status).toBe('up');
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('marks a dependency down when it does not answer in time', async () => {
    vi.useFakeTimers();
    const service = await createService(ok, () => new Promise<void>(() => undefined));

    const pending = service.readiness();
    await vi.advanceTimersByTimeAsync(DEPENDENCY_TIMEOUT_MS + 1);
    const result = await pending;

    expect(result.status).toBe('error');
    expect(result.checks.redis).toMatchObject({ status: 'down', error: 'timeout' });
  });
});

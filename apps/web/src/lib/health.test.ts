import type { ReadinessResponse } from '@dokanflow/shared';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { ApiRequestError } from './api-error';
import { fetchReadiness } from './health';

const readiness: ReadinessResponse = {
  status: 'error',
  checks: {
    database: { status: 'up', latencyMs: 2 },
    redis: { status: 'down', latencyMs: 2000, error: 'timeout' },
  },
  uptimeSeconds: 5,
  timestamp: '2026-11-04T10:00:00.000Z',
};

function stubFetch(status: number, body: unknown): typeof fetch {
  return vi.fn<typeof fetch>(() => Promise.resolve(Response.json(body, { status })));
}

describe('fetchReadiness', () => {
  it('calls the health endpoint under the API base URL', async () => {
    const fetchImpl = stubFetch(200, { ...readiness, status: 'ok' });
    await fetchReadiness('http://api.test/api', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/api/health', expect.any(Object));
  });

  it('parses a 503 readiness body instead of throwing', async () => {
    const result = await fetchReadiness('http://api.test/api', stubFetch(503, readiness));
    expect(result.checks.redis).toEqual({ status: 'down', latencyMs: 2000, error: 'timeout' });
  });

  it('throws ApiRequestError with the shared error body for other statuses', async () => {
    const error = { error: { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Oops' } };
    await expect(
      fetchReadiness('http://api.test/api', stubFetch(500, error)),
    ).rejects.toMatchObject({ name: 'ApiRequestError', status: 500, message: 'Oops' });
  });

  it('throws ApiRequestError even when the error body is not JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('Bad Gateway', { status: 502 })),
    );
    await expect(fetchReadiness('http://api.test/api', fetchImpl)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
  });

  it('rejects a response that does not match the contract', async () => {
    await expect(
      fetchReadiness('http://api.test/api', stubFetch(200, { status: 'ok' })),
    ).rejects.toBeInstanceOf(ZodError);
  });
});

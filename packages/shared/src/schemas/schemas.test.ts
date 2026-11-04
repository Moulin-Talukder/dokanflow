import { describe, expect, it } from 'vitest';
import { apiErrorSchema, readinessResponseSchema } from '../index.js';

describe('readinessResponseSchema', () => {
  const valid = {
    status: 'ok',
    checks: {
      database: { status: 'up', latencyMs: 3 },
      redis: { status: 'down', latencyMs: 1000, error: 'timeout' },
    },
    uptimeSeconds: 12,
    timestamp: '2026-11-04T10:00:00.000Z',
  };

  it('accepts a well-formed response', () => {
    expect(readinessResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown dependency status', () => {
    const result = readinessResponseSchema.safeParse({
      ...valid,
      checks: { ...valid.checks, database: { status: 'degraded', latencyMs: 1 } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects fractional latency', () => {
    const result = readinessResponseSchema.safeParse({
      ...valid,
      checks: { ...valid.checks, database: { status: 'up', latencyMs: 1.5 } },
    });
    expect(result.success).toBe(false);
  });
});

describe('apiErrorSchema', () => {
  it('accepts a validation error with issues', () => {
    const body = {
      error: {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        issues: [{ path: 'name', message: 'Required' }],
        requestId: 'abc',
      },
    };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it('rejects a non-error status code', () => {
    const result = apiErrorSchema.safeParse({
      error: { statusCode: 200, code: 'BAD_REQUEST', message: 'x' },
    });
    expect(result.success).toBe(false);
  });
});

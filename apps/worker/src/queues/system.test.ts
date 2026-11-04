import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { processSystemJob, UnknownJobError } from './system.js';

describe('processSystemJob', () => {
  it('answers a ping with the queue delay', () => {
    const result = processSystemJob(
      { name: 'ping', data: { sentAt: '2026-11-04T10:00:00.000Z' } },
      new Date('2026-11-04T10:00:00.250Z'),
    );
    expect(result).toEqual({
      pong: true,
      receivedAt: '2026-11-04T10:00:00.250Z',
      queueDelayMs: 250,
    });
  });

  it('never reports a negative delay when clocks are skewed', () => {
    const result = processSystemJob(
      { name: 'ping', data: { sentAt: '2026-11-04T10:00:01.000Z' } },
      new Date('2026-11-04T10:00:00.000Z'),
    );
    expect(result.queueDelayMs).toBe(0);
  });

  it('rejects an invalid payload', () => {
    expect(() => processSystemJob({ name: 'ping', data: { sentAt: 'yesterday' } })).toThrow(
      ZodError,
    );
  });

  it('rejects unknown job names', () => {
    expect(() => processSystemJob({ name: 'drop-database', data: {} })).toThrow(UnknownJobError);
  });
});

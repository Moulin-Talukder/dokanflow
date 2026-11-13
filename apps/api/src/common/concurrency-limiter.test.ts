import { describe, expect, it } from 'vitest';
import { ConcurrencyLimiter, ConcurrencyLimitExceededError } from './concurrency-limiter.js';

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('ConcurrencyLimiter', () => {
  it('never runs more than maxConcurrent tasks at once', async () => {
    const limiter = new ConcurrencyLimiter(2, 10);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 6 }, deferred);
    const all = gates.map((gate) =>
      limiter.run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await gate.promise;
        running -= 1;
      }),
    );
    await Promise.resolve();
    expect(limiter.activeCount).toBe(2);
    expect(limiter.queuedCount).toBe(4);
    for (const gate of gates) {
      gate.resolve();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(all);
    expect(peak).toBe(2);
    expect(limiter.activeCount).toBe(0);
  });

  it('rejects immediately once the queue is full', async () => {
    const limiter = new ConcurrencyLimiter(1, 1);
    const gate = deferred();
    const first = limiter.run(() => gate.promise);
    const second = limiter.run(() => Promise.resolve('queued'));
    await expect(limiter.run(() => Promise.resolve('overflow'))).rejects.toBeInstanceOf(
      ConcurrencyLimitExceededError,
    );
    gate.resolve();
    await first;
    expect(await second).toBe('queued');
  });

  it('releases the slot when a task throws', async () => {
    const limiter = new ConcurrencyLimiter(1, 0);
    await expect(limiter.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(limiter.activeCount).toBe(0);
    expect(await limiter.run(() => Promise.resolve(42))).toBe(42);
  });
});

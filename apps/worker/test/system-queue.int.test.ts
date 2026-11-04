import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWorkerEnv } from '../src/env.js';
import { SYSTEM_QUEUE, type PingJobResult } from '../src/queues/system.js';
import { startWorkers, type RunningWorkers } from '../src/worker.js';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

describe('system queue (integration)', () => {
  const env = parseWorkerEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(SYSTEM_QUEUE, { connection });
  const events = new QueueEvents(SYSTEM_QUEUE, { connection: { url: env.REDIS_URL } });
  let workers: RunningWorkers;

  beforeAll(async () => {
    workers = await startWorkers(env, pino({ level: 'silent' }));
    await events.waitUntilReady();
  });

  afterAll(async () => {
    await workers.close();
    await events.close();
    await queue.close();
    await connection.quit();
  });

  it('processes a ping job end to end', async () => {
    const job = await queue.add(
      'ping',
      { sentAt: new Date().toISOString() },
      { removeOnComplete: true, removeOnFail: true },
    );
    const result = (await job.waitUntilFinished(events, 10_000)) as PingJobResult;
    expect(result.pong).toBe(true);
    expect(result.queueDelayMs).toBeGreaterThanOrEqual(0);
  });

  it('fails unknown jobs instead of silently completing them', async () => {
    const job = await queue.add('nope', {}, { removeOnComplete: true, removeOnFail: true });
    await expect(job.waitUntilFinished(events, 10_000)).rejects.toThrow(/Unknown job "nope"/);
  });
});

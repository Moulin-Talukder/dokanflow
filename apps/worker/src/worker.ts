import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { WorkerEnv } from './env.js';
import { processSystemJob, SYSTEM_QUEUE } from './queues/system.js';

export interface RunningWorkers {
  close(): Promise<void>;
}

/** Starts all queue workers. Returned handle closes them gracefully. */
export async function startWorkers(env: WorkerEnv, logger: Logger): Promise<RunningWorkers> {
  // BullMQ workers block on Redis and must retry forever while disconnected.
  const connection = new Redis(env.REDIS_URL, {
    connectionName: 'dokanflow-worker',
    maxRetriesPerRequest: null,
  });

  const system = new Worker(SYSTEM_QUEUE, (job) => Promise.resolve(processSystemJob(job)), {
    connection,
    concurrency: env.WORKER_CONCURRENCY,
  });

  system.on('completed', (job) => {
    logger.debug({ queue: SYSTEM_QUEUE, jobId: job.id, name: job.name }, 'Job completed');
  });
  system.on('failed', (job, error) => {
    logger.error(
      { queue: SYSTEM_QUEUE, jobId: job?.id, name: job?.name, err: error },
      'Job failed',
    );
  });
  system.on('error', (error) => {
    logger.error({ queue: SYSTEM_QUEUE, err: error }, 'Worker error');
  });

  await system.waitUntilReady();
  logger.info({ queues: [SYSTEM_QUEUE], concurrency: env.WORKER_CONCURRENCY }, 'Worker ready');

  return {
    async close() {
      // Lets in-flight jobs finish before closing the shared connection.
      await system.close();
      await connection.quit();
    },
  };
}

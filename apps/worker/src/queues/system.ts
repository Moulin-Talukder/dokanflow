import { z } from 'zod';

/**
 * The "system" queue carries infrastructure jobs. Phase 1 only has `ping`, which
 * proves the API → Redis → worker path end to end. Business queues (invoices,
 * reminders, reports) arrive in Phase 6.
 */
export const SYSTEM_QUEUE = 'system';

export const pingJobDataSchema = z.object({
  /** ISO timestamp set by the producer, so the round trip can be measured. */
  sentAt: z.iso.datetime(),
});
export type PingJobData = z.infer<typeof pingJobDataSchema>;

export interface PingJobResult {
  pong: true;
  receivedAt: string;
  queueDelayMs: number;
}

export interface SystemJob {
  name: string;
  data: unknown;
}

export class UnknownJobError extends Error {
  constructor(queue: string, name: string) {
    super(`Unknown job "${name}" on queue "${queue}"`);
    this.name = 'UnknownJobError';
  }
}

/** Processes a system job. Pure apart from the clock, so it is unit-testable without Redis. */
export function processSystemJob(job: SystemJob, now: Date = new Date()): PingJobResult {
  switch (job.name) {
    case 'ping': {
      // Job payloads come from Redis, so validate them like any other input.
      const data = pingJobDataSchema.parse(job.data);
      return {
        pong: true,
        receivedAt: now.toISOString(),
        queueDelayMs: Math.max(0, now.getTime() - Date.parse(data.sentAt)),
      };
    }
    default:
      throw new UnknownJobError(SYSTEM_QUEUE, job.name);
  }
}

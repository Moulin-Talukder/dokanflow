import { z } from 'zod';

export const dependencyStatusSchema = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const dependencyCheckSchema = z.object({
  status: dependencyStatusSchema,
  /** Round-trip time of the check in milliseconds. */
  latencyMs: z.number().int().nonnegative(),
  /** Short failure reason. Never contains connection strings or credentials. */
  error: z.string().optional(),
});
export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

/** Response of GET /api/health/live. Says only that the process is serving requests. */
export const livenessResponseSchema = z.object({
  status: z.literal('ok'),
});
export type LivenessResponse = z.infer<typeof livenessResponseSchema>;

/** Response of GET /api/health. Reports whether the API can reach its dependencies. */
export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  checks: z.object({
    database: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
  uptimeSeconds: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

import { z } from 'zod';

/** Machine-readable error codes returned by the API. Extend as features are added. */
export const apiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  /** The user must change a temporary password before doing anything else. */
  'PASSWORD_CHANGE_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  /** A stock change would take the quantity below zero. */
  'INSUFFICIENT_STOCK',
  /** The product's unit cannot change after stock has moved. */
  'UNIT_LOCKED',
  /** The server's total differs from the one the client showed (prices changed). */
  'TOTAL_MISMATCH',
  /** The idempotency key was already used for a different request. */
  'IDEMPOTENCY_KEY_REUSED',
  /** The sale has already been voided. */
  'ALREADY_VOIDED',
  'TOO_MANY_REQUESTS',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const validationIssueSchema = z.object({
  /** Dot-separated path to the invalid field, e.g. "items.0.quantity". Empty for the root. */
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

/** The single JSON shape for every API error response. */
export const apiErrorSchema = z.object({
  error: z.object({
    statusCode: z.number().int().min(400).max(599),
    code: apiErrorCodeSchema,
    message: z.string(),
    issues: z.array(validationIssueSchema).optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

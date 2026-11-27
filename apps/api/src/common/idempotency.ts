import { createHash } from 'node:crypto';
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { TransactionClient } from '@dokanflow/db';
import { IDEMPOTENCY_HEADER, idempotencyKeySchema, validationMessageEn } from '@dokanflow/shared';
import type { Request, Response } from 'express';
import { ApiHttpException } from './api-http.exception.js';
import { RequestValidationException } from './request-validation.exception.js';

/** Reads and validates the Idempotency-Key header; it is required where used. */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const value = ctx.switchToHttp().getRequest<Request>().headers[IDEMPOTENCY_HEADER];
    const parsed = idempotencyKeySchema.safeParse(typeof value === 'string' ? value : undefined);
    if (!parsed.success) {
      throw new RequestValidationException([
        { path: 'Idempotency-Key', message: validationMessageEn('validation.idempotencyKey') },
      ]);
    }
    return parsed.data;
  },
);

/** JSON with object keys sorted, so equal requests always hash the same. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export type IdempotencyClaim = { status: 'new' } | { status: 'replay'; resourceId: string };

/**
 * Claims a key inside the caller's transaction. A concurrent request with the same
 * key waits on the unique index until this transaction ends, then sees the stored
 * result (or, if this one rolled back, claims the key itself). A key reused for a
 * different request is refused with 409.
 */
export async function claimIdempotencyKey(
  tx: TransactionClient,
  tenantId: string,
  scope: string,
  key: string,
  hash: string,
): Promise<IdempotencyClaim> {
  const inserted = await tx.$queryRaw<{ key: string }[]>`
    INSERT INTO idempotency_keys (tenant_id, scope, key, request_hash)
    VALUES (${tenantId}::uuid, ${scope}, ${key}, ${hash})
    ON CONFLICT (tenant_id, scope, key) DO NOTHING
    RETURNING key`;
  if (inserted.length > 0) {
    return { status: 'new' };
  }
  const [existing] = await tx.$queryRaw<{ request_hash: string; resource_id: string | null }[]>`
    SELECT request_hash, resource_id FROM idempotency_keys
    WHERE tenant_id = ${tenantId}::uuid AND scope = ${scope} AND key = ${key}`;
  if (existing?.request_hash !== hash || existing.resource_id === null) {
    throw new ApiHttpException(
      409,
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used for a different request',
    );
  }
  return { status: 'replay', resourceId: existing.resource_id };
}

/** Records what the claimed key created, in the same transaction. */
export async function completeIdempotencyKey(
  tx: TransactionClient,
  tenantId: string,
  scope: string,
  key: string,
  resourceId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE idempotency_keys SET resource_id = ${resourceId}::uuid
    WHERE tenant_id = ${tenantId}::uuid AND scope = ${scope} AND key = ${key}`;
}

/** A replay answers 200 (not 201) and says so in a header. */
export function markReplay(res: Response, replayed: boolean): void {
  if (replayed) {
    res.status(200);
    res.setHeader('Idempotent-Replayed', 'true');
  }
}

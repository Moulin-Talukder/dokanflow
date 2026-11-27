import { ApiHttpException } from '../common/api-http.exception.js';

/** Collects messages along an error's cause chain (Prisma wraps driver errors). */
function messages(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else if (typeof current === 'object') {
      parts.push(JSON.stringify(current));
      current = undefined;
    } else {
      if (typeof current === 'string') parts.push(current);
      current = undefined;
    }
  }
  return parts.join(' | ');
}

/**
 * Maps the inventory triggers' exceptions to API errors. The services check the
 * same rules first, under a row lock, so these only fire if that check is bypassed
 * or raced; the database remains the authority.
 */
export function mapInventoryDbError(error: unknown): never {
  const text = messages(error);
  if (text.includes('insufficient_stock')) {
    throw new ApiHttpException(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this change');
  }
  if (text.includes('product_unit_locked')) {
    throw new ApiHttpException(409, 'UNIT_LOCKED', 'The unit cannot change after stock has moved');
  }
  throw error;
}

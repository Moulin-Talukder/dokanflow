import { describe, expect, it } from 'vitest';
import { ApiHttpException } from '../common/api-http.exception.js';
import { escapeLike } from '../catalog/product-query.js';
import { mapInventoryDbError } from './db-errors.js';

describe('mapInventoryDbError', () => {
  const wrapped = (message: string) =>
    new Error('Invalid `prisma.stockMovement.create()` invocation', {
      cause: new Error(`ERROR: ${message}`),
    });

  it('maps the stock trigger to INSUFFICIENT_STOCK, even when wrapped', () => {
    expect(() => mapInventoryDbError(wrapped('insufficient_stock'))).toThrow(ApiHttpException);
    try {
      mapInventoryDbError(wrapped('insufficient_stock'));
    } catch (error) {
      expect(error).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      expect((error as ApiHttpException).getStatus()).toBe(409);
    }
  });

  it('maps the unit-lock trigger to UNIT_LOCKED', () => {
    try {
      mapInventoryDbError(wrapped('product_unit_locked'));
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNIT_LOCKED' });
    }
  });

  it('rethrows anything else unchanged', () => {
    const other = new Error('connection reset');
    expect(() => mapInventoryDbError(other)).toThrow(other);
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\x')).toBe('50\\%\\_off\\\\x');
    expect(escapeLike('rice')).toBe('rice');
  });
});

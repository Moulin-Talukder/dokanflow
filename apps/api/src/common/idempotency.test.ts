import { describe, expect, it } from 'vitest';
import { requestHash, stableStringify } from './idempotency.js';

describe('stableStringify / requestHash', () => {
  it('ignores object key order, so equal requests hash equally', () => {
    const a = {
      lines: [{ productId: 'p', quantity: 1 }],
      payment: { method: 'cash', tenderedPoisha: 5 },
    };
    const b = {
      payment: { tenderedPoisha: 5, method: 'cash' },
      lines: [{ quantity: 1, productId: 'p' }],
    };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(requestHash(a)).toBe(requestHash(b));
  });

  it('distinguishes different values and array order', () => {
    expect(requestHash({ quantity: 1 })).not.toBe(requestHash({ quantity: 2 }));
    expect(requestHash([1, 2])).not.toBe(requestHash([2, 1]));
  });

  it('treats undefined fields as absent and keeps null', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableStringify({ a: null })).toBe('{"a":null}');
  });
});

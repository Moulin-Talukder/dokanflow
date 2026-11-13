import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { estimateEntropyBits, weakSecretReason } from './secret-strength.js';

describe('weakSecretReason', () => {
  it('accepts secrets from openssl rand -base64 48', () => {
    for (let i = 0; i < 50; i++) {
      expect(weakSecretReason(randomBytes(48).toString('base64'))).toBeNull();
    }
  });

  it('rejects the .env.example placeholder and other placeholders', () => {
    expect(weakSecretReason('local-only-change-me-0123456789abcdefghijklmnop')).toMatch(
      /placeholder/,
    );
    expect(weakSecretReason('my-super-SECRET-key-that-is-long-enough-xyz')).toMatch(/placeholder/);
  });

  it('rejects long but low-entropy secrets', () => {
    expect(weakSecretReason('a'.repeat(64))).toMatch(/too little entropy/);
    expect(weakSecretReason('abab'.repeat(16))).toMatch(/too little entropy/);
    expect(weakSecretReason('0123456789'.repeat(4))).toMatch(/too little entropy/);
  });

  it('accepts 32-byte secrets in every common encoding', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = randomBytes(32);
      for (const encoding of ['base64', 'base64url', 'hex'] as const) {
        expect(weakSecretReason(bytes.toString(encoding))).toBeNull();
      }
    }
  });

  it('takes the lower of character-frequency and compression estimates', () => {
    expect(estimateEntropyBits('')).toBe(0);
    expect(estimateEntropyBits('aaaa')).toBe(0);
    // 40 chars of 10 symbols: ~133 bits by frequency, but it compresses well.
    expect(estimateEntropyBits('0123456789'.repeat(4))).toBeLessThan(128);
  });
});

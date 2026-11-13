import { describe, expect, it } from 'vitest';
import {
  assertArgon2Available,
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from './password-hasher.js';

describe('password hashing (Argon2id)', () => {
  it('produces a PHC string with the OWASP baseline parameters', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[\w-]{22}\$[\w-]{43}$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterY', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false (does not throw) for malformed stored hashes', async () => {
    for (const bad of ['', 'plaintext', '$argon2i$v=19$m=1,t=1,p=1$AAAA$AAAA', '$bcrypt$...']) {
      expect(await verifyPassword('x', bad)).toBe(false);
    }
  });

  it('has a reusable dummy hash that never matches by accident', async () => {
    const dummy = await getDummyPasswordHash();
    expect(dummy).toBe(await getDummyPasswordHash());
    expect(await verifyPassword('', dummy)).toBe(false);
  });
});

describe('assertArgon2Available', () => {
  it('passes on the Node version running the tests', () => {
    expect(() => {
      assertArgon2Available();
    }).not.toThrow();
  });

  it('fails clearly on a runtime without crypto.argon2', () => {
    expect(() => {
      assertArgon2Available({}, '24.6.0');
    }).toThrow('unavailable in Node 24.6.0; Node 24.7.0 or later is required');
  });
});

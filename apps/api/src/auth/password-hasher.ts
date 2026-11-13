import * as nodeCrypto from 'node:crypto';
import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Argon2id with the OWASP Password Storage Cheat Sheet baseline:
 * 19 MiB memory, 2 passes, parallelism 1. Uses Node's built-in implementation
 * (node:crypto, v24.7+), so there is no native dependency to build.
 */
export const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

/** Node added crypto.argon2 in v24.7.0. Older runtimes must fail at boot, not at first login. */
export const ARGON2_MIN_NODE = '24.7.0';

export function assertArgon2Available(
  crypto: { argon2?: unknown } = nodeCrypto,
  nodeVersion: string = process.versions.node,
): void {
  if (typeof crypto.argon2 !== 'function') {
    throw new Error(
      `node:crypto argon2 is unavailable in Node ${nodeVersion}; Node ${ARGON2_MIN_NODE} or later is required`,
    );
  }
}

function derive(
  password: string,
  salt: Buffer,
  params: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: password, nonce: salt, ...params }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** PHC string format, as used by other Argon2 libraries: $argon2id$v=19$m=..,t=..,p=..$salt$hash */
function encode(salt: Buffer, hash: Buffer): string {
  const { memory, passes, parallelism } = ARGON2_PARAMS;
  return `$argon2id$v=19$m=${String(memory)},t=${String(passes)},p=${String(parallelism)}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  return encode(salt, await derive(password, salt, ARGON2_PARAMS));
}

/** Constant-time comparison. Returns false (never throws) for malformed hashes. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const match = PHC.exec(encoded);
  if (!match) {
    return false;
  }
  const [, m, t, p, saltText, hashText] = match;
  const expected = Buffer.from(hashText ?? '', 'base64url');
  const actual = await derive(password, Buffer.from(saltText ?? '', 'base64url'), {
    memory: Number(m),
    passes: Number(t),
    parallelism: Number(p),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A real hash of a random password. Verifying against it when the user does not
 * exist makes "unknown user" and "wrong password" take the same time.
 */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHash;
}

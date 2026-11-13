import { deflateRawSync } from 'node:zlib';

/** Fragments of the placeholder secrets shipped in .env.example and docs. */
const PLACEHOLDER_FRAGMENTS = [
  'change-me',
  'changeme',
  'local-only',
  'example',
  'secret',
  'password',
];

/** Minimum estimated entropy for signing secrets: 128 bits, the HS256 security level. */
export const MIN_SECRET_ENTROPY_BITS = 128;

function shannonBits(value: string): number {
  // Iterating a string yields code points, so astral characters count once.
  const counts = new Map<string, number>();
  let length = 0;
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
    length += 1;
  }
  if (length === 0) return 0;
  let perChar = 0;
  for (const count of counts.values()) {
    const p = count / length;
    perChar -= p * Math.log2(p);
  }
  return perChar * length;
}

/**
 * Estimates entropy as the lower of two measures:
 * - character frequencies (Shannon entropy × length), which catches low variety;
 * - compressed size in bits, which catches repetition ("0123456789" × 4).
 * Both overestimate real strength, so this is a filter for placeholders and
 * patterns, not proof of randomness (a sequential alphabet still passes).
 * Real 32-byte secrets (`openssl rand -base64 32` or `-hex 32`) score 189+ bits.
 */
export function estimateEntropyBits(value: string): number {
  if (value.length === 0) return 0;
  const compressedBits = deflateRawSync(Buffer.from(value, 'utf8'), { level: 9 }).length * 8;
  return Math.min(shannonBits(value), compressedBits);
}

/** A reason the secret is unacceptable for production, or null if it is fine. */
export function weakSecretReason(value: string): string | null {
  const lower = value.toLowerCase();
  const placeholder = PLACEHOLDER_FRAGMENTS.find((fragment) => lower.includes(fragment));
  if (placeholder) {
    return `looks like a placeholder (contains "${placeholder}")`;
  }
  const bits = estimateEntropyBits(value);
  if (bits < MIN_SECRET_ENTROPY_BITS) {
    return `too little entropy (about ${String(Math.floor(bits))} bits, need ${String(MIN_SECRET_ENTROPY_BITS)}); generate one with: openssl rand -base64 48`;
  }
  return null;
}

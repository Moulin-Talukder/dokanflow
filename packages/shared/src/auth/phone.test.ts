import { describe, expect, it } from 'vitest';
import { normalizeBdPhone } from './phone.js';

describe('normalizeBdPhone', () => {
  it.each([
    ['01712345678', '+8801712345678'],
    ['+8801712345678', '+8801712345678'],
    ['8801712345678', '+8801712345678'],
    ['008801712345678', '+8801712345678'],
    ['+880 1712-345678', '+8801712345678'],
    [' 017.1234.5678 ', '+8801712345678'],
    ['(017) 1234 5678', '+8801712345678'],
    ['01312345678', '+8801312345678'],
    ['01912345678', '+8801912345678'],
  ])('normalizes %j to %s', (input, expected) => {
    expect(normalizeBdPhone(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['0171234567', 'too short'],
    ['017123456789', 'too long'],
    ['01212345678', 'operator code 2 does not exist'],
    ['01112345678', 'operator code 1 does not exist'],
    ['+447911123456', 'not Bangladeshi'],
    ['1712345678', 'no prefix (ambiguous)'],
    ['01712abc678', 'letters'],
    ['+880+1712345678', 'malformed'],
  ])('rejects %j (%s)', (input) => {
    expect(normalizeBdPhone(input)).toBeNull();
  });
});

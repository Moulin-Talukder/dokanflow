import { describe, expect, it } from 'vitest';
import {
  basisPointsToPercent,
  formatPoisha,
  parsePercentToBasisPoints,
  parseTakaToPoisha,
  poishaToTakaString,
  roundHalfUp,
} from './money.js';

describe('parseTakaToPoisha', () => {
  it.each([
    ['120', 12000],
    ['120.5', 12050],
    ['120.05', 12005],
    ['0.01', 1],
    ['1,250.75', 125075],
    ['৳ 99.99', 9999],
    [' 7 ', 700],
    ['0', 0],
  ])('parses %j as %i poisha', (input, expected) => {
    expect(parseTakaToPoisha(input)).toBe(expected);
  });

  it('never goes through floating point (0.1 + 0.2 style errors)', () => {
    // 1.15 * 100 === 114.99999999999999 in floating point.
    expect(parseTakaToPoisha('1.15')).toBe(115);
    expect(parseTakaToPoisha('4.35')).toBe(435);
  });

  it.each(['', '-5', '1.234', 'abc', '1e3', '12.', '.5', '100000001'])('rejects %j', (input) => {
    expect(parseTakaToPoisha(input)).toBeNull();
  });
});

describe('formatting poisha', () => {
  it('formats with the taka sign, grouping and two decimals', () => {
    expect(formatPoisha(123456)).toBe('৳1,234.56');
    expect(formatPoisha(5)).toBe('৳0.05');
    expect(formatPoisha(0)).toBe('৳0.00');
    expect(formatPoisha(100000000)).toBe('৳1,000,000.00');
    expect(formatPoisha(-250)).toBe('-৳2.50');
  });

  it('round-trips through the form representation', () => {
    for (const poisha of [0, 1, 99, 100, 12345, 99999999]) {
      expect(parseTakaToPoisha(poishaToTakaString(poisha))).toBe(poisha);
    }
  });
});

describe('roundHalfUp (the documented rounding rule)', () => {
  it('reproduces the worked examples in docs/SCHEMA.md', () => {
    expect(roundHalfUp(750n * 12000n, 1000n)).toBe(9000n);
    expect(roundHalfUp(333n * 9999n, 1000n)).toBe(3330n);
    expect(roundHalfUp(10750n * 10000n, 10750n)).toBe(10000n);
    expect(roundHalfUp(9999n * 10000n, 10750n)).toBe(9301n);
    expect(roundHalfUp(1000n * 10000n, 11500n)).toBe(870n);
  });

  it('rounds exact halves up, and handles odd denominators', () => {
    expect(roundHalfUp(5n, 10n)).toBe(1n);
    expect(roundHalfUp(4n, 10n)).toBe(0n);
    expect(roundHalfUp(3n, 2n)).toBe(2n);
    expect(roundHalfUp(2n, 3n)).toBe(1n); // 0.667
    expect(roundHalfUp(1n, 3n)).toBe(0n); // 0.333
  });

  it('rejects negative numerators and non-positive denominators', () => {
    expect(() => roundHalfUp(-1n, 2n)).toThrow(RangeError);
    expect(() => roundHalfUp(1n, 0n)).toThrow(RangeError);
  });
});

describe('VAT rate conversion', () => {
  it.each([
    ['7.5', 750],
    ['15', 1500],
    ['0', 0],
    ['2.25%', 225],
    ['100', 10000],
  ])('parses %j as %i bp', (input, bp) => {
    expect(parsePercentToBasisPoints(input)).toBe(bp);
  });

  it('rejects out-of-range or over-precise rates', () => {
    expect(parsePercentToBasisPoints('100.01')).toBeNull();
    expect(parsePercentToBasisPoints('7.555')).toBeNull();
    expect(parsePercentToBasisPoints('-1')).toBeNull();
  });

  it('formats basis points as a percentage', () => {
    expect(basisPointsToPercent(750)).toBe('7.5');
    expect(basisPointsToPercent(1500)).toBe('15');
    expect(basisPointsToPercent(225)).toBe('2.25');
  });
});

import { describe, expect, it } from 'vitest';
import { formatDisplayQuantity, parseDisplayQuantity } from './units.js';

describe('parseDisplayQuantity', () => {
  it('converts kg and litres to grams and millilitres exactly', () => {
    expect(parseDisplayQuantity('1.5', 'gram')).toBe(1500);
    expect(parseDisplayQuantity('0.25', 'ml')).toBe(250);
    expect(parseDisplayQuantity('2', 'gram')).toBe(2000);
    expect(parseDisplayQuantity('0.001', 'gram')).toBe(1);
    expect(parseDisplayQuantity('1,000', 'gram')).toBe(1_000_000);
  });

  it('only accepts whole pieces', () => {
    expect(parseDisplayQuantity('12', 'piece')).toBe(12);
    expect(parseDisplayQuantity('1.5', 'piece')).toBeNull();
  });

  it('allows a sign only for adjustments', () => {
    expect(parseDisplayQuantity('-0.5', 'gram')).toBeNull();
    expect(parseDisplayQuantity('-0.5', 'gram', { signed: true })).toBe(-500);
    expect(parseDisplayQuantity('+3', 'piece', { signed: true })).toBe(3);
  });

  it('rejects too many decimals, garbage and huge values', () => {
    expect(parseDisplayQuantity('1.2345', 'gram')).toBeNull();
    expect(parseDisplayQuantity('abc', 'piece')).toBeNull();
    expect(parseDisplayQuantity('', 'piece')).toBeNull();
    expect(parseDisplayQuantity('1000001', 'gram')).toBeNull();
  });
});

describe('formatDisplayQuantity', () => {
  it('formats base units in display units without trailing zeros', () => {
    expect(formatDisplayQuantity(1500, 'gram')).toBe('1.5');
    expect(formatDisplayQuantity(250, 'ml')).toBe('0.25');
    expect(formatDisplayQuantity(2000, 'gram')).toBe('2');
    expect(formatDisplayQuantity(1, 'gram')).toBe('0.001');
    expect(formatDisplayQuantity(12, 'piece')).toBe('12');
    expect(formatDisplayQuantity(-500, 'gram')).toBe('-0.5');
  });

  it('round-trips with parseDisplayQuantity', () => {
    for (const [base, unit] of [
      [1500, 'gram'],
      [1, 'ml'],
      [999, 'gram'],
      [7, 'piece'],
    ] as const) {
      expect(parseDisplayQuantity(formatDisplayQuantity(base, unit), unit)).toBe(base);
    }
  });
});

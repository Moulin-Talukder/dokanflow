import { describe, expect, it } from 'vitest';
import { applyStockDelta, isLowStock, replayStockMovements } from './stock.js';

describe('applyStockDelta', () => {
  it('adds stock in and removes stock out', () => {
    expect(applyStockDelta(0, 1500)).toEqual({ ok: true, quantity: 1500 });
    expect(applyStockDelta(1500, -500)).toEqual({ ok: true, quantity: 1000 });
  });

  it('allows taking stock to exactly zero', () => {
    expect(applyStockDelta(250, -250)).toEqual({ ok: true, quantity: 0 });
  });

  it('refuses to go below zero, reporting what is available', () => {
    expect(applyStockDelta(250, -251)).toEqual({
      ok: false,
      reason: 'insufficient_stock',
      available: 250,
    });
  });

  it('rejects zero and non-integer changes', () => {
    expect(applyStockDelta(10, 0)).toEqual({ ok: false, reason: 'invalid_delta' });
    expect(applyStockDelta(10, 1.5)).toEqual({ ok: false, reason: 'invalid_delta' });
  });

  it('rejects a corrupt current level', () => {
    expect(() => applyStockDelta(-1, 1)).toThrow(RangeError);
  });
});

describe('replayStockMovements', () => {
  it('produces each quantity_after; the last equals the sum of all deltas', () => {
    const deltas = [1000, -250, 500, -1250, 30];
    const balances = replayStockMovements(deltas);
    expect(balances).toEqual([1000, 750, 1250, 0, 30]);
    expect(balances.at(-1)).toBe(deltas.reduce((a, b) => a + b, 0));
  });

  it('rejects a history that would ever go negative', () => {
    expect(() => replayStockMovements([100, -50, -60])).toThrow(/movement 2/);
  });

  it('starts from zero for an empty history', () => {
    expect(replayStockMovements([])).toEqual([]);
  });
});

describe('isLowStock', () => {
  it('is low at or below the threshold', () => {
    expect(isLowStock(5, 5)).toBe(true);
    expect(isLowStock(4, 5)).toBe(true);
    expect(isLowStock(6, 5)).toBe(false);
  });

  it('treats an out-of-stock product with a zero threshold as low', () => {
    expect(isLowStock(0, 0)).toBe(true);
  });

  it('never alerts without a threshold', () => {
    expect(isLowStock(0, null)).toBe(false);
  });
});

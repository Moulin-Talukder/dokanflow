/**
 * Stock arithmetic. The database trigger on stock_movements is the authority (it
 * locks the stock row and applies the same rule); the API uses these to give a
 * clear error before writing, and the web app to display state.
 */

export type StockDeltaResult =
  | { ok: true; quantity: number }
  | { ok: false; reason: 'insufficient_stock'; available: number }
  | { ok: false; reason: 'invalid_delta' };

/** Applies a movement to the current quantity. Stock can never go below zero. */
export function applyStockDelta(current: number, delta: number): StockDeltaResult {
  if (!Number.isSafeInteger(current) || current < 0) {
    throw new RangeError('current stock must be a non-negative integer');
  }
  if (!Number.isSafeInteger(delta) || delta === 0) {
    return { ok: false, reason: 'invalid_delta' };
  }
  const quantity = current + delta;
  if (quantity < 0) {
    return { ok: false, reason: 'insufficient_stock', available: current };
  }
  return { ok: true, quantity };
}

/**
 * Replays movements from zero, returning each quantity_after. Throws if any step
 * would go negative. This is the invariant the reconciliation check relies on:
 * the stock level equals the last running balance, i.e. the sum of all deltas.
 */
export function replayStockMovements(deltas: readonly number[]): number[] {
  const balances: number[] = [];
  let quantity = 0;
  for (const [index, delta] of deltas.entries()) {
    const result = applyStockDelta(quantity, delta);
    if (!result.ok) {
      throw new RangeError(`movement ${String(index)} is invalid: ${result.reason}`);
    }
    quantity = result.quantity;
    balances.push(quantity);
  }
  return balances;
}

/** Low stock means at or below the product's threshold. No threshold, no alert. */
export function isLowStock(quantity: number, threshold: number | null): boolean {
  return threshold !== null && quantity <= threshold;
}

import {
  calculateSale,
  cashChangePoisha,
  type CreateSaleInput,
  type Discount,
  parseDiscountInput,
  parseQuantityWithUnit,
  parseTakaToPoisha,
  type Product,
  type SaleTotals,
} from '@dokanflow/shared';

/** A cart line keeps the text the cashier typed; it is parsed on every render. */
export interface CartLine {
  product: Product;
  quantityInput: string;
  discountInput: string;
}

export interface CartState {
  lines: CartLine[];
  saleDiscountInput: string;
  cashInput: string;
}

export type LineIssue = 'invalid_quantity' | 'invalid_discount' | 'discount_too_large';
export type SaleDiscountIssue = 'invalid' | 'too_large';

export interface CartEvaluation {
  lineIssues: (LineIssue | null)[];
  saleDiscountIssue: SaleDiscountIssue | null;
  /** Null while any input is invalid. */
  totals: SaleTotals | null;
  /** Cash received in poisha, null if blank or invalid. */
  cashPoisha: number | null;
  /** Change to give, null if cash is missing or short. */
  changePoisha: number | null;
  cashShort: boolean;
  /** The request body, ready to send, when everything is valid and paid. */
  request: CreateSaleInput | null;
}

export const emptyCart: CartState = { lines: [], saleDiscountInput: '', cashInput: '' };

/**
 * Adds a product. Scanning an item already in the cart adds one more piece; for
 * weighed items the quantity is left for the cashier to type.
 */
export function addToCart(lines: CartLine[], product: Product): CartLine[] {
  const existing = lines.findIndex((l) => l.product.id === product.id);
  if (existing === -1) {
    return [...lines, { product, quantityInput: '1', discountInput: '' }];
  }
  if (product.unit !== 'piece') return lines;
  return lines.map((line, i) => {
    if (i !== existing) return line;
    const current = parseQuantityWithUnit(line.quantityInput, 'piece');
    return { ...line, quantityInput: String((current ?? 0) + 1) };
  });
}

/**
 * Parses every input and computes the totals with the same shared calculator the
 * API uses, so the screen shows exactly what the server will record.
 */
export function evaluateCart(state: CartState): CartEvaluation {
  const lineIssues: (LineIssue | null)[] = [];
  const parsed: { quantity: number; discount: Discount | null }[] = [];
  for (const line of state.lines) {
    const quantity = parseQuantityWithUnit(line.quantityInput, line.product.unit);
    const discount = parseDiscountInput(line.discountInput);
    if (quantity === null || quantity <= 0) lineIssues.push('invalid_quantity');
    else if (!discount.ok) lineIssues.push('invalid_discount');
    else lineIssues.push(null);
    parsed.push({ quantity: quantity ?? 0, discount: discount.ok ? discount.discount : null });
  }
  const saleDiscountParsed = parseDiscountInput(state.saleDiscountInput);
  let saleDiscountIssue: SaleDiscountIssue | null = saleDiscountParsed.ok ? null : 'invalid';
  const saleDiscount = saleDiscountParsed.ok ? saleDiscountParsed.discount : null;

  let totals: SaleTotals | null = null;
  // `some` rather than `every`: an inferred type predicate would narrow lineIssues to null[].
  if (state.lines.length > 0 && !lineIssues.some((i) => i !== null) && saleDiscountIssue === null) {
    const result = calculateSale(
      state.lines.map((line, i) => ({
        unit: line.product.unit,
        quantity: parsed[i]?.quantity ?? 0,
        unitPricePoisha: line.product.pricePoisha,
        vatRateBp: line.product.vatRateBp,
        discount: parsed[i]?.discount ?? null,
      })),
      saleDiscount,
    );
    if (result.ok) {
      totals = result.totals;
    } else if (result.error.kind === 'line_discount_exceeds_price') {
      lineIssues[result.error.line] = 'discount_too_large';
    } else {
      saleDiscountIssue = 'too_large';
    }
  }

  const cashPoisha = state.cashInput.trim() === '' ? null : parseTakaToPoisha(state.cashInput);
  const changePoisha =
    totals && cashPoisha !== null ? cashChangePoisha(totals.totalPoisha, cashPoisha) : null;
  const cashShort = totals !== null && cashPoisha !== null && changePoisha === null;

  const request: CreateSaleInput | null =
    totals && cashPoisha !== null && changePoisha !== null
      ? {
          lines: state.lines.map((line, i) => ({
            productId: line.product.id,
            quantity: parsed[i]?.quantity ?? 0,
            discount: parsed[i]?.discount ?? null,
          })),
          saleDiscount,
          payment: { method: 'cash', tenderedPoisha: cashPoisha },
          expectedTotalPoisha: totals.totalPoisha,
        }
      : null;

  return { lineIssues, saleDiscountIssue, totals, cashPoisha, changePoisha, cashShort, request };
}

/** 64-bit FNV-1a over a string, as 16 hex characters. */
function fnv1a64(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * The Idempotency-Key for a sale attempt: the same cart in the same POS session
 * always gives the same key (so retries and double-clicks are de-duplicated by the
 * server), while each completed sale bumps `saleCounter` so the next one is new.
 */
export function saleIdempotencyKey(
  sessionNonce: string,
  saleCounter: number,
  request: CreateSaleInput,
): string {
  return `pos-${sessionNonce}-${String(saleCounter)}-${fnv1a64(JSON.stringify(request))}`;
}

'use client';

import {
  formatDisplayQuantity,
  formatPoisha,
  IDEMPOTENCY_HEADER,
  productListResponseSchema,
  productSchema,
  type Product,
  type Sale,
  saleSchema,
} from '@dokanflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { formatQuantity } from '@/components/catalog/format';
import { toQueryString } from '@/components/catalog/query-string';
import { catalogKey } from '@/components/catalog/use-catalog';
import { FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { ApiRequestError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import {
  addToCart,
  type CartLine,
  emptyCart,
  evaluateCart,
  type LineIssue,
  saleIdempotencyKey,
} from './cart';

export function PosView() {
  const t = useT();
  const queryClient = useQueryClient();
  const { client, session, can } = useAuth();
  const searchRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState(emptyCart);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [barcode, setBarcode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stockIssues, setStockIssues] = useState<Record<number, string>>({});
  const [completed, setCompleted] = useState<Sale | null>(null);
  // Bumped after each completed sale, so an identical next cart gets a new key.
  const [saleCounter, setSaleCounter] = useState(0);

  const evaluation = useMemo(() => evaluateCart(cart), [cart]);
  // One key per distinct request, derived (not random per render): a double-click or
  // a retry after a network error re-sends the same key, so the server records the
  // sale only once. The session nonce and counter make each new sale's key unique.
  const [sessionNonce] = useState(() => crypto.randomUUID().replace(/-/g, ''));
  const idempotencyKey = evaluation.request
    ? saleIdempotencyKey(sessionNonce, saleCounter, evaluation.request)
    : null;

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setHighlight(0);
    }, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  // F2: search, F4: barcode, Ctrl+Enter: complete the sale.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === 'F4') {
        event.preventDefault();
        barcodeRef.current?.focus();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  });

  const results = useQuery({
    queryKey: catalogKey(session?.tenant.id, 'pos-search', search),
    queryFn: ({ signal }) =>
      client.request('GET', `/products?${toQueryString({ search, pageSize: 8 })}`, {
        schema: productListResponseSchema,
        signal,
      }),
    enabled: search !== '',
  });
  const found = search === '' ? [] : (results.data?.items ?? []);

  function updateLines(update: (lines: CartLine[]) => CartLine[]) {
    setCart((current) => ({ ...current, lines: update(current.lines) }));
    setStockIssues({});
    setError(null);
  }

  function add(product: Product) {
    setCompleted(null);
    setNotice(null);
    updateLines((lines) => addToCart(lines, product));
  }

  async function scan(code: string) {
    const value = code.trim();
    if (value === '') return;
    setNotice(null);
    try {
      const list = await client.request(
        'GET',
        `/products?${toQueryString({ search: value, pageSize: 5 })}`,
        {
          schema: productListResponseSchema,
        },
      );
      const match = list.items.find((p) => p.barcode === value || p.sku === value.toUpperCase());
      if (match) {
        add(match);
        setBarcode('');
      } else {
        setNotice(t('pos.barcodeNotFound', { code: value }));
      }
    } catch (e) {
      setNotice(errorMessage(e, t));
    }
  }

  /** After a price change, reload every cart product so the screen matches the server. */
  async function refreshCartPrices() {
    const fresh = await Promise.all(
      cart.lines.map((line) =>
        client.request('GET', `/products/${line.product.id}`, { schema: productSchema }),
      ),
    );
    setCart((current) => ({
      ...current,
      lines: current.lines.map((line) => ({
        ...line,
        product: fresh.find((p) => p.id === line.product.id) ?? line.product,
      })),
    }));
  }

  const sale = useMutation({
    mutationFn: ({ body, key }: { body: unknown; key: string }) =>
      client.request('POST', '/sales', {
        body,
        schema: saleSchema,
        headers: { [IDEMPOTENCY_HEADER]: key },
      }),
    onSuccess: async (result) => {
      setCompleted(result);
      setCart(emptyCart);
      setSaleCounter((n) => n + 1);
      setSearchInput('');
      await queryClient.invalidateQueries({ queryKey: catalogKey(session?.tenant.id) });
      searchRef.current?.focus();
    },
    onError: async (e) => {
      if (e instanceof ApiRequestError && e.body?.error.code === 'INSUFFICIENT_STOCK') {
        const issues: Record<number, string> = {};
        for (const issue of e.body.error.issues ?? []) {
          const index = Number(/^lines\.(\d+)\./.exec(issue.path)?.[1]);
          const line = cart.lines[index];
          if (line) issues[index] = t('pos.insufficientStock', { name: line.product.name });
        }
        setStockIssues(issues);
        setError(Object.values(issues).join(' ') || errorMessage(e, t));
      } else if (e instanceof ApiRequestError && e.body?.error.code === 'TOTAL_MISMATCH') {
        setError(t('pos.pricesChanged'));
        await refreshCartPrices();
      } else {
        setError(errorMessage(e, t));
      }
    },
  });

  function submit() {
    if (!evaluation.request || !idempotencyKey || sale.isPending) return;
    setError(null);
    sale.mutate({ body: evaluation.request, key: idempotencyKey });
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(found.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      const product = found[highlight];
      if (product) {
        add(product);
        setSearchInput('');
      }
    } else if (event.key === 'Escape') {
      setSearchInput('');
    }
  }

  const issueText = (issue: LineIssue | null, line: CartLine): string | null => {
    if (issue === 'invalid_quantity') {
      return t('pos.invalidQuantity', { example: t(`pos.quantityHint.${line.product.unit}`) });
    }
    if (issue === 'invalid_discount') return t('pos.invalidDiscount');
    if (issue === 'discount_too_large') return t('pos.discountTooLarge');
    return null;
  };

  if (!can('sale:create')) {
    return <FormMessage kind="error">{t('error.forbidden')}</FormMessage>;
  }

  const totals = evaluation.totals;

  return (
    <div className="pos">
      <h1 className="visually-hidden">{t('pos.title')}</h1>
      <section className="pos-find stack" aria-label={t('pos.region.find')}>
        <div className="field">
          <label htmlFor="pos-search">{t('pos.searchLabel')}</label>
          <input
            id="pos-search"
            ref={searchRef}
            type="search"
            autoFocus
            autoComplete="off"
            placeholder={t('pos.searchPlaceholder')}
            value={searchInput}
            role="combobox"
            aria-expanded={found.length > 0}
            aria-controls="pos-results"
            aria-activedescendant={found[highlight] ? `pos-result-${String(highlight)}` : undefined}
            onChange={(e) => {
              setSearchInput(e.target.value);
            }}
            onKeyDown={onSearchKey}
          />
        </div>
        {search !== '' ? (
          <ul id="pos-results" className="pos-results" role="listbox">
            {found.length === 0 && !results.isPending ? (
              <li className="muted">{t('pos.noResults')}</li>
            ) : null}
            {found.map((product, i) => (
              <li
                key={product.id}
                id={`pos-result-${String(i)}`}
                role="option"
                aria-selected={i === highlight}
                className={i === highlight ? 'active' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(product);
                  setSearchInput('');
                }}
              >
                <span>
                  <strong>{product.name}</strong> <code>{product.sku}</code>
                </span>
                <span className="muted">
                  {formatPoisha(product.pricePoisha)} {t(`unit.${product.unit}.per`)} ·{' '}
                  {product.stockQuantity > 0
                    ? t('pos.inStock', {
                        quantity: formatQuantity(t, product.stockQuantity, product.unit),
                      })
                    : t('pos.outOfStock')}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="field">
          <label htmlFor="pos-barcode">{t('pos.barcodeLabel')}</label>
          <input
            id="pos-barcode"
            ref={barcodeRef}
            autoComplete="off"
            inputMode="numeric"
            placeholder={t('pos.barcodePlaceholder')}
            value={barcode}
            onChange={(e) => {
              setBarcode(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void scan(barcode);
              }
            }}
          />
        </div>
        {notice ? <FormMessage kind="error">{notice}</FormMessage> : null}
      </section>

      <section className="pos-cart stack" aria-label={t('pos.region.cart')}>
        {completed ? (
          <div className="form-message form-message-success stack" role="status">
            <strong>{t('pos.completed', { invoice: completed.invoiceNumber })}</strong>
            {completed.payments[0]?.changePoisha != null ? (
              <span className="pos-change">
                {t('pos.changeDue', { amount: formatPoisha(completed.payments[0].changePoisha) })}
              </span>
            ) : null}
            <span className="row">
              <Link className="button" href={`/app/sales/${completed.id}/invoice`}>
                {t('pos.printInvoice')}
              </Link>
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setCompleted(null);
                  searchRef.current?.focus();
                }}
              >
                {t('pos.newSale')}
              </button>
            </span>
          </div>
        ) : null}

        {cart.lines.length === 0 ? (
          completed ? null : (
            <p className="muted">{t('pos.cartEmpty')}</p>
          )
        ) : (
          <div className="table-wrap">
            <table className="pos-table">
              <thead>
                <tr>
                  <th scope="col">{t('pos.col.item')}</th>
                  <th scope="col" className="numeric">
                    {t('pos.col.price')}
                  </th>
                  <th scope="col">{t('pos.col.quantity')}</th>
                  <th scope="col">{t('pos.col.discount')}</th>
                  <th scope="col" className="numeric">
                    {t('pos.col.total')}
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">{t('pos.col.item')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cart.lines.map((line, i) => {
                  const issue = stockIssues[i] ?? issueText(evaluation.lineIssues[i] ?? null, line);
                  return (
                    <tr key={line.product.id} className={issue ? 'has-issue' : undefined}>
                      <td>
                        {line.product.name}
                        <div className="muted small">
                          {formatDisplayQuantity(line.product.stockQuantity, line.product.unit)}{' '}
                          {t(`unit.${line.product.unit}.short`)}
                        </div>
                        {issue ? (
                          <div className="field-error" role="alert">
                            {issue}
                          </div>
                        ) : null}
                      </td>
                      <td className="numeric">
                        {formatPoisha(line.product.pricePoisha)}
                        <div className="muted small">{t(`unit.${line.product.unit}.per`)}</div>
                      </td>
                      <td>
                        <input
                          className="pos-input"
                          aria-label={t('pos.quantityLabel', { name: line.product.name })}
                          placeholder={t(`pos.quantityHint.${line.product.unit}`)}
                          value={line.quantityInput}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateLines((lines) =>
                              lines.map((l, j) => (j === i ? { ...l, quantityInput: value } : l)),
                            );
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="pos-input"
                          aria-label={t('pos.discountLabel', { name: line.product.name })}
                          placeholder="10% / 5"
                          value={line.discountInput}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateLines((lines) =>
                              lines.map((l, j) => (j === i ? { ...l, discountInput: value } : l)),
                            );
                          }}
                        />
                      </td>
                      <td className="numeric">
                        {/* After the line discount only, as on the invoice; the sale discount shows in the totals. */}
                        {totals ? formatPoisha(totals.lines[i]?.netPoisha ?? 0) : '—'}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button-link"
                          aria-label={t('pos.remove', { name: line.product.name })}
                          onClick={() => {
                            updateLines((lines) => lines.filter((_, j) => j !== i));
                          }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="pos-totals card stack" aria-label={t('pos.region.payment')}>
        <div className="field">
          <label htmlFor="pos-sale-discount">{t('pos.saleDiscountLabel')}</label>
          <input
            id="pos-sale-discount"
            placeholder="10% / 50"
            value={cart.saleDiscountInput}
            aria-invalid={evaluation.saleDiscountIssue ? true : undefined}
            onChange={(e) => {
              setCart((c) => ({ ...c, saleDiscountInput: e.target.value }));
            }}
          />
          {evaluation.saleDiscountIssue ? (
            <p className="field-error" role="alert">
              {evaluation.saleDiscountIssue === 'invalid'
                ? t('pos.invalidDiscount')
                : t('pos.saleDiscountTooLarge')}
            </p>
          ) : null}
        </div>
        <dl className="totals">
          <dt>{t('pos.subtotal')}</dt>
          <dd>{totals ? formatPoisha(totals.subtotalPoisha) : '—'}</dd>
          <dt>{t('pos.discounts')}</dt>
          <dd>{totals ? formatPoisha(-totals.discountPoisha) : '—'}</dd>
          <dt>{t('pos.vatIncluded')}</dt>
          <dd>{totals ? formatPoisha(totals.taxPoisha) : '—'}</dd>
          <dt className="grand">{t('pos.total')}</dt>
          <dd className="grand" data-testid="pos-total">
            {totals ? formatPoisha(totals.totalPoisha) : '—'}
          </dd>
        </dl>
        <div className="field">
          <label htmlFor="pos-cash">{t('pos.cashReceived')}</label>
          <input
            id="pos-cash"
            inputMode="decimal"
            autoComplete="off"
            value={cart.cashInput}
            aria-invalid={evaluation.cashShort ? true : undefined}
            onChange={(e) => {
              setCart((c) => ({ ...c, cashInput: e.target.value }));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          {evaluation.cashShort ? (
            <p className="field-error" role="alert">
              {t('pos.cashShort')}
            </p>
          ) : null}
        </div>
        <dl className="totals">
          <dt>{t('pos.change')}</dt>
          <dd data-testid="pos-change">
            {evaluation.changePoisha !== null ? formatPoisha(evaluation.changePoisha) : '—'}
          </dd>
        </dl>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <button
          type="button"
          className="button button-large"
          disabled={!evaluation.request || sale.isPending}
          onClick={submit}
        >
          {sale.isPending ? t('pos.completing') : t('pos.complete')}
        </button>
        {cart.lines.length > 0 ? (
          <button
            type="button"
            className="button-link"
            onClick={() => {
              setCart(emptyCart);
              setStockIssues({});
              setError(null);
            }}
          >
            {t('pos.clear')}
          </button>
        ) : null}
      </section>
    </div>
  );
}

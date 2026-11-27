'use client';

import {
  formatDisplayQuantity,
  IDEMPOTENCY_HEADER,
  parseDisplayQuantity,
  type Product,
  stockChangeResponseSchema,
  stockMovementListResponseSchema,
} from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Pagination } from '@/components/common/pagination';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatQuantity, formatSignedQuantity } from './format';
import { catalogKey } from './use-catalog';

type Message = { kind: 'error' | 'success'; text: string } | null;

function signedDisplayQuantity(delta: number, unit: Product['unit']): string {
  return `${delta > 0 ? '+' : ''}${formatDisplayQuantity(delta, unit)}`;
}

function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  // Products list, this product and its history all change with the stock.
  return () => queryClient.invalidateQueries({ queryKey: catalogKey(session?.tenant.id) });
}

export function StockPanel({ product }: { product: Product }) {
  const t = useT();
  const { can } = useAuth();
  const unitLabel = t(`unit.${product.unit}.short`);
  const editable = can('stock:write') && !product.archived;

  return (
    <section className="card stack">
      <h2>{t('stock.title')}</h2>
      <p className="stock-figure">
        {t('stock.current', {
          quantity: formatDisplayQuantity(product.stockQuantity, product.unit),
          unit: unitLabel,
        })}
      </p>
      {product.isLowStock && product.lowStockThreshold !== null ? (
        <p className="alert" role="status">
          {t('stock.lowNotice', {
            threshold: formatDisplayQuantity(product.lowStockThreshold, product.unit),
            unit: unitLabel,
          })}
        </p>
      ) : null}
      {product.archived ? <p className="muted">{t('product.archivedNotice')}</p> : null}
      {editable ? (
        <div className="grid-2 align-start">
          <StockInForm product={product} />
          <AdjustForm product={product} />
        </div>
      ) : null}
      <MovementHistory product={product} />
    </section>
  );
}

function StockInForm({ product }: { product: Product }) {
  const t = useT();
  const { client } = useAuth();
  const invalidate = useInvalidateCatalog();
  const [message, setMessage] = useState<Message>(null);
  const unitLabel = t(`unit.${product.unit}.short`);
  const schema = useMemo(
    () =>
      z
        .object({ quantity: z.string(), note: z.string().max(200, 'validation.tooLong') })
        .transform((v, ctx) => {
          const quantity = parseDisplayQuantity(v.quantity, product.unit);
          if (quantity === null || quantity <= 0) {
            ctx.addIssue({
              code: 'custom',
              path: ['quantity'],
              message: 'validation.quantityPositive',
            });
          }
          return { quantity: quantity ?? 0, ...(v.note.trim() ? { note: v.note.trim() } : {}) };
        }),
    [product.unit],
  );
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { quantity: '', note: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: z.output<typeof schema>) =>
      client.request('POST', `/products/${product.id}/stock/in`, {
        body,
        schema: stockChangeResponseSchema,
        // One key per submission: the server applies it once even if the request is retried.
        headers: { [IDEMPOTENCY_HEADER]: crypto.randomUUID() },
      }),
    onSuccess: async (result) => {
      setMessage({
        kind: 'success',
        text: t('stock.in.done', {
          quantity: formatDisplayQuantity(result.movement.quantityDelta, product.unit),
          unit: unitLabel,
        }),
      });
      form.reset();
      await invalidate();
    },
    onError: (e) => {
      setMessage({ kind: 'error', text: errorMessage(e, t) });
    },
  });

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setMessage(null);
          mutation.mutate(values);
        })(event)
      }
    >
      <h3>{t('stock.in.title')}</h3>
      <Field
        id="stock-in-quantity"
        label={t('stock.in.quantity', { unit: unitLabel })}
        inputMode="decimal"
        error={translateMessage(t, form.formState.errors.quantity?.message)}
        {...form.register('quantity')}
      />
      <Field
        id="stock-in-note"
        label={t('stock.in.note')}
        error={translateMessage(t, form.formState.errors.note?.message)}
        {...form.register('note')}
      />
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <button type="submit" className="button" disabled={mutation.isPending}>
        {t('stock.in.submit')}
      </button>
    </form>
  );
}

function AdjustForm({ product }: { product: Product }) {
  const t = useT();
  const { client } = useAuth();
  const invalidate = useInvalidateCatalog();
  const [message, setMessage] = useState<Message>(null);
  const unitLabel = t(`unit.${product.unit}.short`);
  const schema = useMemo(
    () =>
      z.object({ delta: z.string(), reason: z.string() }).transform((v, ctx) => {
        const delta = parseDisplayQuantity(v.delta, product.unit, { signed: true });
        if (delta === null || delta === 0) {
          ctx.addIssue({ code: 'custom', path: ['delta'], message: 'validation.signedQuantity' });
        }
        if (v.reason.trim().length < 3) {
          ctx.addIssue({ code: 'custom', path: ['reason'], message: 'validation.reasonRequired' });
        }
        return { delta: delta ?? 0, reason: v.reason.trim() };
      }),
    [product.unit],
  );
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { delta: '', reason: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: z.output<typeof schema>) =>
      client.request('POST', `/products/${product.id}/stock/adjustments`, {
        body,
        schema: stockChangeResponseSchema,
        headers: { [IDEMPOTENCY_HEADER]: crypto.randomUUID() },
      }),
    onSuccess: async (result) => {
      setMessage({
        kind: 'success',
        text: t('stock.adjust.done', {
          delta: signedDisplayQuantity(result.movement.quantityDelta, product.unit),
          unit: unitLabel,
        }),
      });
      form.reset();
      await invalidate();
    },
    onError: (e) => {
      setMessage({
        kind: 'error',
        text: errorMessage(e, t, {}, { INSUFFICIENT_STOCK: 'stock.insufficient' }),
      });
    },
  });

  return (
    <form
      className="stack"
      noValidate
      onSubmit={(event) =>
        void form.handleSubmit((values) => {
          setMessage(null);
          mutation.mutate(values);
        })(event)
      }
    >
      <h3>{t('stock.adjust.title')}</h3>
      <Field
        id="stock-adjust-delta"
        label={t('stock.adjust.delta', { unit: unitLabel })}
        inputMode="decimal"
        error={translateMessage(t, form.formState.errors.delta?.message)}
        {...form.register('delta')}
      />
      <Field
        id="stock-adjust-reason"
        label={t('stock.adjust.reason')}
        hint={t('stock.adjust.reasonHint')}
        error={translateMessage(t, form.formState.errors.reason?.message)}
        {...form.register('reason')}
      />
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}
      <button type="submit" className="button" disabled={mutation.isPending}>
        {t('stock.adjust.submit')}
      </button>
    </form>
  );
}

function MovementHistory({ product }: { product: Product }) {
  const t = useT();
  const { client, session } = useAuth();
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: catalogKey(session?.tenant.id, 'movements', product.id, page),
    queryFn: ({ signal }) =>
      client.request(
        'GET',
        `/products/${product.id}/stock/movements?page=${String(page)}&pageSize=10`,
        {
          schema: stockMovementListResponseSchema,
          signal,
        },
      ),
  });

  return (
    <div className="stack">
      <h3>{t('stock.history.title')}</h3>
      {history.isPending ? (
        <p className="muted">{t('common.loading')}</p>
      ) : history.isError ? (
        <FormMessage kind="error">{errorMessage(history.error, t)}</FormMessage>
      ) : history.data.items.length === 0 ? (
        <p className="muted">{t('stock.history.empty')}</p>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('stock.history.when')}</th>
                  <th scope="col">{t('stock.history.type')}</th>
                  <th scope="col" className="numeric">
                    {t('stock.history.change')}
                  </th>
                  <th scope="col" className="numeric">
                    {t('stock.history.after')}
                  </th>
                  <th scope="col">{t('stock.history.by')}</th>
                  <th scope="col">{t('stock.history.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {history.data.items.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.createdAt)}</td>
                    <td>{t(`stock.type.${m.type}`)}</td>
                    <td className="numeric">
                      {formatSignedQuantity(t, m.quantityDelta, product.unit)}
                    </td>
                    <td className="numeric">{formatQuantity(t, m.quantityAfter, product.unit)}</td>
                    <td>{m.actor.name}</td>
                    <td>{m.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={history.data.page}
            pageSize={history.data.pageSize}
            total={history.data.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

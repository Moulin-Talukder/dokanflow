'use client';

import { formatPoisha, productSchema } from '@dokanflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { ApiRequestError } from '@/lib/api-error';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import { formatQuantity } from './format';
import { ProductForm } from './product-form';
import { StockPanel } from './stock-panel';
import { catalogKey } from './use-catalog';

export function ProductDetailView({ productId }: { productId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { client, session, can } = useAuth();
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const product = useQuery({
    queryKey: catalogKey(session?.tenant.id, 'product', productId),
    queryFn: ({ signal }) =>
      client.request('GET', `/products/${productId}`, { schema: productSchema, signal }),
    retry: (count, error) =>
      !(error instanceof ApiRequestError && [400, 404].includes(error.status)) && count < 1,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: catalogKey(session?.tenant.id) });
  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      client.request('PATCH', `/products/${productId}`, {
        body: { archived },
        schema: productSchema,
      }),
    onSuccess: invalidate,
    onError: (e) => {
      setMessage({ kind: 'error', text: errorMessage(e, t) });
    },
  });

  if (product.isPending) return <p className="muted">{t('common.loading')}</p>;
  if (product.isError) {
    const notFound =
      product.error instanceof ApiRequestError && [400, 404].includes(product.error.status);
    return (
      <div className="stack">
        <FormMessage kind="error">
          {notFound ? t('product.notFound') : errorMessage(product.error, t)}
        </FormMessage>
        <Link href="/app/products">{t('common.back')}</Link>
      </div>
    );
  }
  const p = product.data;

  return (
    <div className="stack">
      <p>
        <Link href="/app/products">{t('common.back')}</Link>
      </p>
      <div className="row space-between">
        <h1>
          {p.name}{' '}
          {p.archived ? <span className="badge">{t('products.archivedBadge')}</span> : null}
        </h1>
        {can('catalog:write') ? (
          <button
            type="button"
            className="button-link"
            disabled={archive.isPending}
            onClick={() => {
              archive.mutate(!p.archived);
            }}
          >
            {p.archived ? t('product.restore') : t('product.archive')}
          </button>
        ) : null}
      </div>
      <p className="muted">
        <code>{p.sku}</code> · {formatPoisha(p.pricePoisha)} {t(`unit.${p.unit}.per`)} ·{' '}
        {formatQuantity(t, p.stockQuantity, p.unit)}
      </p>
      {message ? <FormMessage kind={message.kind}>{message.text}</FormMessage> : null}

      <StockPanel product={p} />

      {can('catalog:write') ? (
        <section className="card stack">
          <h2>{t('product.editTitle')}</h2>
          <ProductForm
            key={p.updatedAt}
            product={p}
            submitLabel={t('product.form.save')}
            onSubmit={async (values) => {
              setMessage(null);
              try {
                await client.request('PATCH', `/products/${productId}`, {
                  body: values,
                  schema: productSchema,
                });
                await invalidate();
                setMessage({ kind: 'success', text: t('product.form.saved') });
              } catch (e) {
                setMessage({
                  kind: 'error',
                  text: errorMessage(
                    e,
                    t,
                    { 409: 'product.form.skuTaken' },
                    { UNIT_LOCKED: 'product.form.unitLocked' },
                  ),
                });
              }
            }}
          />
        </section>
      ) : null}
    </div>
  );
}

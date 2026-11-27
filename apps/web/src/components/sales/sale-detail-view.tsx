'use client';

import { type VoidSaleRequest, voidSaleRequestSchema, saleSchema } from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { formatDateTime } from '@/components/catalog/format';
import { catalogKey } from '@/components/catalog/use-catalog';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';
import { SaleLines } from './sale-lines';
import { isNotFound, useSale } from './use-sale';

type Message = { kind: 'error' | 'success'; text: string } | null;

export function SaleDetailView({ saleId }: { saleId: string }) {
  const t = useT();
  const sale = useSale(saleId);
  const { can } = useAuth();
  // Kept here, not in the form: a successful void unmounts the form.
  const [voidMessage, setVoidMessage] = useState<Message>(null);

  if (sale.isPending) return <p className="muted">{t('common.loading')}</p>;
  if (sale.isError) {
    return (
      <div className="stack">
        <FormMessage kind="error">
          {isNotFound(sale.error) ? t('sale.notFound') : errorMessage(sale.error, t)}
        </FormMessage>
        <Link href="/app/sales">{t('common.back')}</Link>
      </div>
    );
  }
  const s = sale.data;

  return (
    <div className="stack narrow-wide">
      <p>
        <Link href="/app/sales">{t('common.back')}</Link>
      </p>
      <div className="row space-between">
        <h1>
          {s.invoiceNumber}{' '}
          {s.status === 'voided' ? (
            <span className="badge badge-warning">{t('sales.status.voided')}</span>
          ) : null}
        </h1>
        <Link className="button" href={`/app/sales/${s.id}/invoice`}>
          {t('pos.printInvoice')}
        </Link>
      </div>
      <p className="muted">
        {formatDateTime(s.createdAt)} · {t('sale.cashier', { name: s.cashier.name })}
      </p>
      {voidMessage ? <FormMessage kind={voidMessage.kind}>{voidMessage.text}</FormMessage> : null}
      {s.void ? (
        <p className="alert" role="status">
          {t('sale.voidedNotice', {
            date: formatDateTime(s.void.at),
            name: s.void.by.name,
            reason: s.void.reason,
          })}
        </p>
      ) : null}
      <section className="card">
        <SaleLines sale={s} />
      </section>
      {s.status === 'completed' && can('sale:void') ? (
        <VoidForm saleId={s.id} onMessage={setVoidMessage} />
      ) : null}
    </div>
  );
}

function VoidForm({
  saleId,
  onMessage,
}: {
  saleId: string;
  onMessage: (message: Message) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { client, session } = useAuth();
  const form = useForm<VoidSaleRequest>({
    resolver: zodResolver(voidSaleRequestSchema),
    defaultValues: { reason: '' },
  });
  const mutation = useMutation({
    mutationFn: (body: VoidSaleRequest) =>
      client.request('POST', `/sales/${saleId}/void`, { body, schema: saleSchema }),
    onSuccess: async () => {
      onMessage({ kind: 'success', text: t('sale.void.done') });
      await queryClient.invalidateQueries({ queryKey: catalogKey(session?.tenant.id) });
    },
    onError: (e) => {
      onMessage({
        kind: 'error',
        text: errorMessage(e, t, {}, { ALREADY_VOIDED: 'sale.void.already' }),
      });
    },
  });

  return (
    <section className="card stack">
      <h2>{t('sale.void.title')}</h2>
      <p className="muted">{t('sale.void.hint')}</p>
      <form
        className="stack"
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            onMessage(null);
            mutation.mutate(values);
          })(event)
        }
      >
        <Field
          id="void-reason"
          label={t('sale.void.reason')}
          error={translateMessage(t, form.formState.errors.reason?.message)}
          {...form.register('reason')}
        />
        <button type="submit" className="button button-danger" disabled={mutation.isPending}>
          {t('sale.void.submit')}
        </button>
      </form>
    </section>
  );
}

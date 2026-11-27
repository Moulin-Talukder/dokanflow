'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDateTime } from '@/components/catalog/format';
import { FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { errorMessage } from '@/lib/error-message';
import { SaleLines } from './sale-lines';
import { isNotFound, useSale } from './use-sale';

/**
 * Printable invoice. `?format=receipt` lays it out for 80 mm thermal paper,
 * otherwise A4. Printing hides the app's navigation. Not a Mushak invoice.
 */
export function InvoiceView({ saleId }: { saleId: string }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const receipt = searchParams.get('format') === 'receipt';
  const sale = useSale(saleId);

  if (sale.isPending) return <p className="muted">{t('common.loading')}</p>;
  if (sale.isError) {
    return (
      <FormMessage kind="error">
        {isNotFound(sale.error) ? t('sale.notFound') : errorMessage(sale.error, t)}
      </FormMessage>
    );
  }
  const s = sale.data;

  return (
    <div className={receipt ? 'invoice-page receipt' : 'invoice-page a4'}>
      {/* Paper size for the browser's print dialog. */}
      <style>
        {receipt ? '@page { size: 80mm auto; margin: 4mm; }' : '@page { size: A4; margin: 15mm; }'}
      </style>
      <div className="row no-print invoice-toolbar">
        <Link href={`/app/sales/${s.id}`}>{t('invoice.backToSale')}</Link>
        <button
          type="button"
          className={receipt ? 'button-link' : 'button-link active'}
          aria-pressed={!receipt}
          onClick={() => {
            router.replace(`/app/sales/${s.id}/invoice`);
          }}
        >
          {t('invoice.formatA4')}
        </button>
        <button
          type="button"
          className={receipt ? 'button-link active' : 'button-link'}
          aria-pressed={receipt}
          onClick={() => {
            router.replace(`/app/sales/${s.id}/invoice?format=receipt`);
          }}
        >
          {t('invoice.formatReceipt')}
        </button>
        <button
          type="button"
          className="button"
          onClick={() => {
            window.print();
          }}
        >
          {t('invoice.print')}
        </button>
      </div>

      <article className="invoice" aria-label={t('invoice.title')}>
        <header className="invoice-header">
          <h1>{s.shopName}</h1>
          <p>
            <strong>{t('invoice.number', { number: s.invoiceNumber })}</strong>
          </p>
          <p>
            {t('invoice.date')}: {formatDateTime(s.createdAt)}
            <br />
            {t('invoice.cashier')}: {s.cashier.name}
          </p>
          {s.status === 'voided' ? (
            <p className="voided-stamp">{t('invoice.voidedStamp')}</p>
          ) : null}
        </header>
        <SaleLines sale={s} compact={receipt} />
        <footer className="invoice-footer">
          <p className="small">{t('invoice.vatNote')}</p>
          <p>{t('invoice.thanks')}</p>
        </footer>
      </article>
    </div>
  );
}

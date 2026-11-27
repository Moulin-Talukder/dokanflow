import type { Metadata } from 'next';
import { Suspense } from 'react';
import { InvoiceView } from '@/components/sales/invoice-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('invoice.title') };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // useSearchParams (paper format) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <InvoiceView saleId={id} />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { SaleDetailView } from '@/components/sales/sale-detail-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('sales.title') };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SaleDetailView saleId={id} />;
}

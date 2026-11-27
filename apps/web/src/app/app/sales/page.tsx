import type { Metadata } from 'next';
import { SalesListView } from '@/components/sales/sales-list-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('sales.title') };

export default function Page() {
  return <SalesListView />;
}

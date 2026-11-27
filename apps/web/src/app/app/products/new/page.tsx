import type { Metadata } from 'next';
import { ProductNewView } from '@/components/catalog/product-new-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('product.newTitle') };

export default function Page() {
  return <ProductNewView />;
}

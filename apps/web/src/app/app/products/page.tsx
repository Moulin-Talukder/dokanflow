import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProductsView } from '@/components/catalog/products-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('products.title') };

export default function Page() {
  // useSearchParams (initial low-stock filter) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <ProductsView />
    </Suspense>
  );
}

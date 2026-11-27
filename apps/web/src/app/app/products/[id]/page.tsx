import type { Metadata } from 'next';
import { ProductDetailView } from '@/components/catalog/product-detail-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('products.title') };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProductDetailView productId={id} />;
}

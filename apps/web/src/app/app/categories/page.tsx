import type { Metadata } from 'next';
import { CategoriesView } from '@/components/catalog/categories-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('categories.title') };

export default function Page() {
  return <CategoriesView />;
}

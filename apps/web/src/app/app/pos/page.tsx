import type { Metadata } from 'next';
import { PosView } from '@/components/pos/pos-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('pos.title') };

export default function Page() {
  return <PosView />;
}

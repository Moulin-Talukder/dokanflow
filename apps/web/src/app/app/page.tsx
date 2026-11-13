import type { Metadata } from 'next';
import { HomeView } from '@/components/app/home-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('nav.home') };

export default function Page() {
  return <HomeView />;
}

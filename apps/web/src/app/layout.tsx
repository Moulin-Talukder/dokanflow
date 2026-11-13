import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { createTranslator } from '@/i18n/translate';
import { Providers } from './providers';
import './globals.css';

const t = createTranslator('en');

export const metadata: Metadata = {
  title: { default: t('app.name'), template: `%s · ${t('app.name')}` },
  description: t('app.tagline'),
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

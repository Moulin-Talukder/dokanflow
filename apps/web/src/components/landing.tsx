'use client';

import Link from 'next/link';
import { ApiStatus } from '@/components/api-status';
import { useT } from '@/i18n/i18n';
import { useAuth } from '@/lib/auth/auth-provider';

export function Landing() {
  const t = useT();
  const { status } = useAuth();
  return (
    <main className="container">
      <h1>{t('app.name')}</h1>
      <p className="lead">{t('app.tagline')}</p>
      <p className="row">
        {status === 'authenticated' ? (
          <Link className="button" href="/app">
            {t('nav.home')}
          </Link>
        ) : (
          <>
            <Link className="button" href="/login">
              {t('landing.login')}
            </Link>
            <Link href="/register">{t('landing.register')}</Link>
          </>
        )}
      </p>
      <ApiStatus />
    </main>
  );
}

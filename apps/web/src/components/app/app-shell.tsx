'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';

/**
 * Wraps every signed-in page. Redirects to /login without a session and to
 * /change-password while a temporary password is in use. These redirects are a
 * convenience: the API enforces the same rules on every request.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { status, session, client, can } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
    else if (session?.user.mustChangePassword) router.replace('/change-password');
  }, [status, session, router]);

  if (status !== 'authenticated' || !session || session.user.mustChangePassword) {
    return <main className="container muted">{t('common.loading')}</main>;
  }

  async function switchShop(tenantId: string) {
    setSwitching(true);
    setError(null);
    try {
      await client.switchTenant(tenantId);
      router.replace('/app');
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSwitching(false);
    }
  }

  async function logout() {
    try {
      await client.logout();
    } finally {
      router.replace('/login');
    }
  }

  const navLink = (href: string, label: string) => (
    <Link href={href} aria-current={pathname === href ? 'page' : undefined}>
      {label}
    </Link>
  );

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <strong>{t('app.name')}</strong>
          <nav aria-label="Main">
            {navLink('/app', t('nav.home'))}
            {can('staff:read') ? navLink('/app/staff', t('nav.staff')) : null}
          </nav>
          <div className="app-header-end">
            {session.memberships.length > 1 ? (
              <label className="shop-switcher">
                <span className="visually-hidden">{t('nav.shop')}</span>
                <select
                  value={session.tenant.id}
                  disabled={switching}
                  onChange={(e) => void switchShop(e.target.value)}
                >
                  {session.memberships.map((m) => (
                    <option key={m.tenantId} value={m.tenantId}>
                      {m.tenantName}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>{session.tenant.name}</span>
            )}
            <button type="button" className="button-link" onClick={() => void logout()}>
              {t('nav.logout')}
            </button>
          </div>
        </div>
      </header>
      <main className="container">
        {switching ? <p className="muted">{t('nav.switchingShop')}</p> : null}
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        {children}
      </main>
    </>
  );
}

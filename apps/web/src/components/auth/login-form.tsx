'use client';

import { type LoginRequest, loginRequestSchema } from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const { client, status, session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { identifier: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  // Already signed in (e.g. restored from the refresh cookie): skip the form.
  useEffect(() => {
    if (status === 'authenticated' && session) {
      router.replace(session.user.mustChangePassword ? '/change-password' : '/app');
    }
  }, [status, session, router]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await client.login(values);
    } catch (e) {
      setError(errorMessage(e, t, { 401: 'login.invalid' }));
    }
  });

  return (
    <main className="container narrow">
      <h1>{t('login.title')}</h1>
      <form className="card stack" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Field
          id="identifier"
          label={t('login.identifier')}
          hint={t('login.identifierHint')}
          autoComplete="username"
          inputMode="email"
          error={translateMessage(t, errors.identifier?.message)}
          {...form.register('identifier')}
        />
        <Field
          id="password"
          type="password"
          label={t('login.password')}
          autoComplete="current-password"
          error={translateMessage(t, errors.password?.message)}
          {...form.register('password')}
        />
        <button type="submit" className="button" disabled={isSubmitting}>
          {isSubmitting ? t('common.loading') : t('login.submit')}
        </button>
      </form>
      <p className="muted">
        {t('login.noAccount')} <Link href="/register">{t('login.registerLink')}</Link>
      </p>
    </main>
  );
}

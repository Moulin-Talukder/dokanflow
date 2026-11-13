'use client';

import { type RegisterRequest, registerRequestSchema } from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage } from '@/lib/error-message';

export function RegisterForm() {
  const t = useT();
  const router = useRouter();
  const { client } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { businessName: '', name: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await client.register(values);
      router.replace('/app');
    } catch (e) {
      setError(errorMessage(e, t, { 409: 'register.emailTaken' }));
    }
  });

  return (
    <main className="container narrow">
      <h1>{t('register.title')}</h1>
      <form className="card stack" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Field
          id="businessName"
          label={t('register.businessName')}
          autoComplete="organization"
          error={translateMessage(t, errors.businessName?.message)}
          {...form.register('businessName')}
        />
        <Field
          id="name"
          label={t('register.name')}
          autoComplete="name"
          error={translateMessage(t, errors.name?.message)}
          {...form.register('name')}
        />
        <Field
          id="email"
          type="email"
          label={t('register.email')}
          autoComplete="email"
          error={translateMessage(t, errors.email?.message)}
          {...form.register('email')}
        />
        <Field
          id="password"
          type="password"
          label={t('register.password')}
          hint={t('register.passwordHint')}
          autoComplete="new-password"
          error={translateMessage(t, errors.password?.message)}
          {...form.register('password')}
        />
        <button type="submit" className="button" disabled={isSubmitting}>
          {isSubmitting ? t('common.loading') : t('register.submit')}
        </button>
      </form>
      <p className="muted">
        {t('register.haveAccount')} <Link href="/login">{t('register.loginLink')}</Link>
      </p>
    </main>
  );
}

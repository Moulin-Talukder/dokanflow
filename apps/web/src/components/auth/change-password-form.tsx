'use client';

import { changePasswordRequestSchema } from '@dokanflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Field, FormMessage } from '@/components/form/field';
import { useT } from '@/i18n/i18n';
import { translateMessage } from '@/i18n/translate';
import { useAuth } from '@/lib/auth/auth-provider';
import { errorMessage, fieldErrors } from '@/lib/error-message';

/** The shared request schema plus a confirmation field that never leaves the browser. */
const formSchema = changePasswordRequestSchema
  .and(z.object({ confirmPassword: z.string() }))
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'changePassword.mismatch',
  });
type FormValues = z.infer<typeof formSchema>;

export function ChangePasswordForm() {
  const t = useT();
  const router = useRouter();
  const { client, status, session } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null);
    setServerFieldErrors({});
    try {
      await client.changePassword({ currentPassword, newPassword });
      router.replace('/app');
    } catch (e) {
      const fields = fieldErrors(e);
      if (Object.keys(fields).length > 0) setServerFieldErrors(fields);
      else setError(errorMessage(e, t));
    }
  });

  if (status !== 'authenticated') {
    return <main className="container narrow muted">{t('common.loading')}</main>;
  }

  return (
    <main className="container narrow">
      <h1>{t('changePassword.title')}</h1>
      {session?.user.mustChangePassword ? (
        <FormMessage kind="error">{t('changePassword.required')}</FormMessage>
      ) : null}
      <form className="card stack" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Field
          id="currentPassword"
          type="password"
          label={t('changePassword.current')}
          autoComplete="current-password"
          error={translateMessage(
            t,
            errors.currentPassword?.message ?? serverFieldErrors.currentPassword,
          )}
          {...form.register('currentPassword')}
        />
        <Field
          id="newPassword"
          type="password"
          label={t('changePassword.new')}
          hint={t('register.passwordHint')}
          autoComplete="new-password"
          error={translateMessage(t, errors.newPassword?.message ?? serverFieldErrors.newPassword)}
          {...form.register('newPassword')}
        />
        <Field
          id="confirmPassword"
          type="password"
          label={t('changePassword.confirm')}
          autoComplete="new-password"
          error={translateMessage(t, errors.confirmPassword?.message)}
          {...form.register('confirmPassword')}
        />
        <button type="submit" className="button" disabled={isSubmitting}>
          {isSubmitting ? t('common.loading') : t('changePassword.submit')}
        </button>
      </form>
    </main>
  );
}

import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/login-form';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('login.title') };

export default function Page() {
  return <LoginForm />;
}

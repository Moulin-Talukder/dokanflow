import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/register-form';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('register.title') };

export default function Page() {
  return <RegisterForm />;
}

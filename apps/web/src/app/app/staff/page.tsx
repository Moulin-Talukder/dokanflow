import type { Metadata } from 'next';
import { StaffView } from '@/components/app/staff-view';
import { createTranslator } from '@/i18n/translate';

export const metadata: Metadata = { title: createTranslator('en')('staff.title') };

export default function Page() {
  return <StaffView />;
}

'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { createTranslator, type Locale, type TranslateFn } from './translate';

export type { Locale, TranslateFn } from './translate';

const I18nContext = createContext<TranslateFn>(createTranslator('en'));

export function I18nProvider({
  locale = 'en',
  children,
}: {
  locale?: Locale;
  children: ReactNode;
}) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  return <I18nContext.Provider value={t}>{children}</I18nContext.Provider>;
}

export function useT(): TranslateFn {
  return useContext(I18nContext);
}

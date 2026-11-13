import { en, type MessageKey, type Messages } from './messages/en';

/** Server-safe translation (no React). The provider in i18n.tsx wraps this for components. */
export type Locale = 'en';

const catalogs: Record<Locale, Messages> = { en };

export type TranslateFn = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Replaces {name} placeholders. Unknown placeholders are left as-is so gaps are visible. */
export function format(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

export function createTranslator(locale: Locale): TranslateFn {
  const messages = catalogs[locale];
  return (key, values) => format(messages[key], values);
}

export function isMessageKey(value: string): value is MessageKey {
  return Object.hasOwn(en, value);
}

/** Translates a validation message if it is a known key; otherwise shows it unchanged. */
export function translateMessage(t: TranslateFn, message: string | undefined): string | undefined {
  if (message === undefined) return undefined;
  return isMessageKey(message) ? t(message) : message;
}

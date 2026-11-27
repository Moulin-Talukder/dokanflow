import { formatDisplayQuantity, type ProductUnit } from '@dokanflow/shared';
import type { TranslateFn } from '@/i18n/translate';

/** A base-unit quantity in display units with its label, e.g. 1500 g → "1.5 kg". */
export function formatQuantity(t: TranslateFn, baseUnits: number, unit: ProductUnit): string {
  return `${formatDisplayQuantity(baseUnits, unit)} ${t(`unit.${unit}.short`)}`;
}

/** Signed change for movement history, e.g. "+2.5 kg" or "-0.25 L". */
export function formatSignedQuantity(t: TranslateFn, delta: number, unit: ProductUnit): string {
  return `${delta > 0 ? '+' : ''}${formatQuantity(t, delta, unit)}`;
}

const dhaka = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Dhaka',
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** Timestamps are stored in UTC and shown in Asia/Dhaka (docs/SCHEMA.md conventions). */
export function formatDateTime(iso: string): string {
  return dhaka.format(new Date(iso));
}

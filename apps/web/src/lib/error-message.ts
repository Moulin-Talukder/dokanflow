import type { MessageKey } from '@/i18n/messages/en';
import type { TranslateFn } from '@/i18n/translate';
import { ApiRequestError } from './api-error';

/**
 * A user-facing message for a failed request. `byStatus` maps specific statuses
 * to page-specific messages (e.g. 409 on registration).
 */
export function errorMessage(
  error: unknown,
  t: TranslateFn,
  byStatus: Partial<Record<number, MessageKey>> = {},
): string {
  if (error instanceof ApiRequestError) {
    const specific = byStatus[error.status];
    if (specific) return t(specific);
    if (error.status === 401) return t('error.sessionExpired');
    if (error.status === 403) return t('error.forbidden');
    if (error.status < 500 && error.body) return error.body.error.message;
    return t('common.unexpectedError');
  }
  if (error instanceof TypeError) return t('common.networkError');
  return t('common.unexpectedError');
}

/** Field-level messages from a VALIDATION_FAILED response, keyed by field path. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiRequestError) || error.body?.error.code !== 'VALIDATION_FAILED') {
    return {};
  }
  return Object.fromEntries((error.body.error.issues ?? []).map((i) => [i.path, i.message]));
}

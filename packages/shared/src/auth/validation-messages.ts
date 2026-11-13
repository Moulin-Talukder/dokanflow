/**
 * Validation messages are stable keys, not English text, so each client can
 * translate them. The API maps them to English for its error responses; the web
 * app translates them with its own catalogue.
 */
export const VALIDATION_MESSAGES_EN = {
  'validation.required': 'Required',
  'validation.tooLong': 'Too long',
  'validation.email': 'Enter a valid email address',
  'validation.phone': 'Enter a valid Bangladeshi mobile number',
  'validation.passwordMin': 'Use at least 10 characters',
  'validation.passwordMax': 'Use at most 128 characters',
  'validation.passwordSame': 'Choose a password different from the current one',
} as const;

export type ValidationMessageKey = keyof typeof VALIDATION_MESSAGES_EN;

export function isValidationMessageKey(value: string): value is ValidationMessageKey {
  return Object.hasOwn(VALIDATION_MESSAGES_EN, value);
}

/** English text for a key; any other message is returned unchanged. */
export function validationMessageEn(message: string): string {
  return isValidationMessageKey(message) ? VALIDATION_MESSAGES_EN[message] : message;
}

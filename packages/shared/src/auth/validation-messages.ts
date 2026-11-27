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
  'validation.sku': 'Use 1–40 letters, digits, dots, dashes or underscores',
  'validation.barcode': 'Use 4–64 letters, digits or dashes',
  'validation.wholeNumber': 'Must be a whole number',
  'validation.nonNegative': 'Cannot be negative',
  'validation.positive': 'Must be more than zero',
  'validation.nonZero': 'Cannot be zero',
  'validation.tooLarge': 'Too large',
  'validation.reasonRequired': 'Give a reason (at least 3 characters)',
  'validation.noChanges': 'Nothing to change',
} as const;

export type ValidationMessageKey = keyof typeof VALIDATION_MESSAGES_EN;

export function isValidationMessageKey(value: string): value is ValidationMessageKey {
  return Object.hasOwn(VALIDATION_MESSAGES_EN, value);
}

/** English text for a key; any other message is returned unchanged. */
export function validationMessageEn(message: string): string {
  return isValidationMessageKey(message) ? VALIDATION_MESSAGES_EN[message] : message;
}

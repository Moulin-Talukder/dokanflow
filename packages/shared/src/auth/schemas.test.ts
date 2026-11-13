import { describe, expect, it } from 'vitest';
import {
  changePasswordRequestSchema,
  createStaffRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
} from './schemas.js';
import { isValidationMessageKey, validationMessageEn } from './validation-messages.js';

describe('registerRequestSchema', () => {
  it('trims names and normalizes the email', () => {
    const parsed = registerRequestSchema.parse({
      businessName: '  Rahim Store ',
      name: ' Rahim ',
      email: '  Rahim@Example.COM ',
      password: 'correct horse battery',
    });
    expect(parsed).toMatchObject({
      businessName: 'Rahim Store',
      name: 'Rahim',
      email: 'rahim@example.com',
    });
  });

  it('rejects passwords shorter than 10 or longer than 128 characters', () => {
    const base = { businessName: 'Shop', name: 'Owner', email: 'o@example.com' };
    expect(registerRequestSchema.safeParse({ ...base, password: 'short' }).success).toBe(false);
    expect(registerRequestSchema.safeParse({ ...base, password: 'x'.repeat(129) }).success).toBe(
      false,
    );
    expect(registerRequestSchema.safeParse({ ...base, password: 'x'.repeat(10) }).success).toBe(
      true,
    );
  });
});

describe('createStaffRequestSchema', () => {
  it('requires an email for managers', () => {
    const ok = createStaffRequestSchema.parse({
      role: 'manager',
      name: 'Karim',
      email: 'Karim@Shop.test',
      temporaryPassword: 'temporary-123',
    });
    expect(ok).toMatchObject({ role: 'manager', email: 'karim@shop.test' });

    const missing = createStaffRequestSchema.safeParse({
      role: 'manager',
      name: 'Karim',
      phone: '01712345678',
      temporaryPassword: 'temporary-123',
    });
    expect(missing.success).toBe(false);
  });

  it('requires a phone for cashiers and normalizes it', () => {
    const ok = createStaffRequestSchema.parse({
      role: 'cashier',
      name: 'Salma',
      phone: '017 1234 5678',
      temporaryPassword: 'temporary-123',
    });
    expect(ok).toMatchObject({ role: 'cashier', phone: '+8801712345678' });

    const bad = createStaffRequestSchema.safeParse({
      role: 'cashier',
      name: 'Salma',
      phone: '12345',
      temporaryPassword: 'temporary-123',
    });
    expect(bad.success).toBe(false);
  });

  it('cannot create another owner', () => {
    const result = createStaffRequestSchema.safeParse({
      role: 'owner',
      name: 'Usurper',
      email: 'u@shop.test',
      temporaryPassword: 'temporary-123',
    });
    expect(result.success).toBe(false);
  });
});

describe('changePasswordRequestSchema', () => {
  it('rejects reusing the current password', () => {
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: 'same-password-1',
      newPassword: 'same-password-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginRequestSchema', () => {
  it('does not apply password length rules to login attempts', () => {
    expect(loginRequestSchema.safeParse({ identifier: 'a@b.c', password: 'x' }).success).toBe(true);
  });
});

describe('validation messages', () => {
  it('uses translatable keys that all have English text', () => {
    const result = registerRequestSchema.safeParse({
      businessName: '',
      name: 'x'.repeat(101),
      email: 'nope',
      password: 'short',
    });
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toEqual([
      'validation.required',
      'validation.tooLong',
      'validation.email',
      'validation.passwordMin',
    ]);
    for (const message of messages) {
      expect(isValidationMessageKey(message)).toBe(true);
      expect(validationMessageEn(message)).not.toBe(message);
    }
  });

  it('passes through messages that are not keys', () => {
    expect(validationMessageEn('Invalid UUID')).toBe('Invalid UUID');
  });
});

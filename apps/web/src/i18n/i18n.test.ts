import { describe, expect, it } from 'vitest';
import { createTranslator, format, translateMessage } from './translate';
import { en } from './messages/en';

describe('i18n', () => {
  const t = createTranslator('en');

  it('looks up messages by key', () => {
    expect(t('login.title')).toBe('Log in');
  });

  it('fills placeholders', () => {
    expect(t('home.welcome', { name: 'Rahim' })).toBe('Welcome, Rahim');
    expect(format('{a} and {b}', { a: 1, b: 'two' })).toBe('1 and two');
  });

  it('leaves unknown placeholders visible', () => {
    expect(format('Hello {name}')).toBe('Hello {name}');
  });

  it('has no empty messages', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('translates validation keys from the shared schemas and passes other text through', () => {
    expect(translateMessage(t, 'validation.passwordMin')).toBe('Use at least 10 characters');
    expect(translateMessage(t, 'Already taken')).toBe('Already taken');
    expect(translateMessage(t, undefined)).toBeUndefined();
  });
});

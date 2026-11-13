import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readCookie, refreshCookieConfig } from './refresh-cookie.js';
import { testEnv } from './test-env.js';

describe('refreshCookieConfig', () => {
  it('development: httpOnly, not Secure, SameSite=Strict, scoped to /api/auth', () => {
    const { name, options } = refreshCookieConfig(testEnv());
    expect(name).toBe('dokanflow_rt');
    expect(options).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    expect(options.domain).toBeUndefined();
  });

  it('production: Secure with the __Secure- prefix', () => {
    const { name, options } = refreshCookieConfig(
      testEnv({ NODE_ENV: 'production', API_CORS_ORIGINS: 'https://app.example.com' }),
    );
    expect(name).toBe('__Secure-dokanflow_rt');
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict' });
  });

  it('cross-site deployments: SameSite=None with Secure and an optional domain', () => {
    const { options } = refreshCookieConfig(
      testEnv({
        AUTH_COOKIE_SAMESITE: 'none',
        AUTH_COOKIE_SECURE: 'true',
        AUTH_COOKIE_DOMAIN: 'api.example.com',
      }),
    );
    expect(options).toMatchObject({ sameSite: 'none', secure: true, domain: 'api.example.com' });
  });
});

describe('readCookie', () => {
  const req = (cookie?: string): Request => ({ headers: { cookie } }) as Request;

  it('reads a named cookie among others', () => {
    expect(readCookie(req('a=1; dokanflow_rt=abc-123; b=2'), 'dokanflow_rt')).toBe('abc-123');
  });

  it('returns undefined when absent or malformed', () => {
    expect(readCookie(req(), 'dokanflow_rt')).toBeUndefined();
    expect(readCookie(req('dokanflow_rtx=1'), 'dokanflow_rt')).toBeUndefined();
    expect(readCookie(req('dokanflow_rt=%E0%A4%A'), 'dokanflow_rt')).toBeUndefined();
  });
});

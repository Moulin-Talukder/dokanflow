import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readRefreshCookie, refreshCookieConfig } from './refresh-cookie.js';
import { testEnv } from './test-env.js';

describe('refreshCookieConfig', () => {
  it('local http: plain name, httpOnly, not Secure, SameSite=Strict, Path=/', () => {
    const { name, options } = refreshCookieConfig(testEnv());
    expect(name).toBe('dokanflow_rt');
    expect(options).toEqual({ httpOnly: true, secure: false, sameSite: 'strict', path: '/' });
  });

  it('production: __Host- prefix with Path=/ and no Domain', () => {
    const { name, options } = refreshCookieConfig(
      testEnv({ NODE_ENV: 'production', API_CORS_ORIGINS: 'https://app.example.com' }),
    );
    expect(name).toBe('__Host-dokanflow_rt');
    expect(options).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
  });

  it('with a cookie domain: falls back to __Secure- (Domain is not allowed with __Host-)', () => {
    const { name, options } = refreshCookieConfig(
      testEnv({
        AUTH_COOKIE_SAMESITE: 'none',
        AUTH_COOKIE_SECURE: 'true',
        AUTH_COOKIE_DOMAIN: 'api.example.com',
      }),
    );
    expect(name).toBe('__Secure-dokanflow_rt');
    expect(options).toMatchObject({ sameSite: 'none', secure: true, domain: 'api.example.com' });
  });
});

describe('readRefreshCookie', () => {
  const req = (cookie?: string): Request => ({ headers: { cookie } }) as Request;
  const NAME = 'dokanflow_rt';

  it('reads the cookie among others', () => {
    expect(readRefreshCookie(req('a=1; dokanflow_rt=abc-123; b=2'), NAME)).toEqual({
      status: 'ok',
      token: 'abc-123',
    });
  });

  it('reports a missing, empty or undecodable cookie as missing', () => {
    expect(readRefreshCookie(req(), NAME).status).toBe('missing');
    expect(readRefreshCookie(req('dokanflow_rtx=1'), NAME).status).toBe('missing');
    expect(readRefreshCookie(req('dokanflow_rt='), NAME).status).toBe('missing');
    expect(readRefreshCookie(req('dokanflow_rt=%E0%A4%A'), NAME).status).toBe('missing');
  });

  it('flags duplicate cookies (e.g. one planted by another subdomain)', () => {
    expect(readRefreshCookie(req('dokanflow_rt=mine; dokanflow_rt=planted'), NAME).status).toBe(
      'duplicate',
    );
  });
});

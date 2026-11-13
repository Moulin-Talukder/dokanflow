import type { CookieOptions, Request } from 'express';
import type { ApiEnv } from '../config/env.js';

/** Where the refresh cookie lived before Phase 2 review fixes; cleared on logout and errors. */
export const LEGACY_REFRESH_COOKIE_PATH = '/api/auth';

export interface RefreshCookieConfig {
  name: string;
  /** Flags shared by setting and clearing. The expiry is added per response. */
  options: CookieOptions;
}

/**
 * Cookie name and flags per environment:
 * - Secure, no domain (normal production): `__Host-` prefix with Path=/. Browsers
 *   then refuse any same-named cookie set by another subdomain or over http, which
 *   prevents cookie tossing.
 * - Secure with AUTH_COOKIE_DOMAIN: `__Host-` forbids a Domain attribute, so the
 *   weaker `__Secure-` prefix is used.
 * - Not Secure (local http): no prefix.
 */
export function refreshCookieConfig(env: ApiEnv): RefreshCookieConfig {
  const secure = env.AUTH_COOKIE_SECURE;
  const domain = env.AUTH_COOKIE_DOMAIN;
  const name = !secure ? 'dokanflow_rt' : domain ? '__Secure-dokanflow_rt' : '__Host-dokanflow_rt';
  return {
    name,
    options: {
      httpOnly: true,
      secure,
      sameSite: env.AUTH_COOKIE_SAMESITE,
      path: '/',
      ...(domain ? { domain } : {}),
    },
  };
}

export type RefreshCookie =
  { status: 'missing' } | { status: 'duplicate' } | { status: 'ok'; token: string };

/**
 * Reads the refresh cookie from the Cookie header. Two cookies with the same name
 * mean someone else (another subdomain, an old path) planted one; the request is
 * then refused rather than guessing which to trust.
 */
export function readRefreshCookie(req: Request, name: string): RefreshCookie {
  const header = req.headers.cookie;
  if (!header) {
    return { status: 'missing' };
  }
  const values: string[] = [];
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) {
      values.push(part.slice(index + 1).trim());
    }
  }
  if (values.length > 1) {
    return { status: 'duplicate' };
  }
  const raw = values[0];
  if (raw === undefined || raw === '') {
    return { status: 'missing' };
  }
  try {
    return { status: 'ok', token: decodeURIComponent(raw) };
  } catch {
    return { status: 'missing' };
  }
}

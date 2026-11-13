import type { CookieOptions, Request } from 'express';
import type { ApiEnv } from '../config/env.js';

/** Only the auth endpoints receive the cookie. */
export const REFRESH_COOKIE_PATH = '/api/auth';

export interface RefreshCookieConfig {
  name: string;
  options: CookieOptions;
}

/**
 * Cookie flags per environment. In production the cookie is Secure, which also
 * lets it use the __Secure- prefix: browsers then refuse to accept it over http
 * or from a page that did not set it securely.
 */
export function refreshCookieConfig(env: ApiEnv): RefreshCookieConfig {
  const secure = env.AUTH_COOKIE_SECURE;
  return {
    name: secure ? '__Secure-dokanflow_rt' : 'dokanflow_rt',
    options: {
      httpOnly: true,
      secure,
      sameSite: env.AUTH_COOKIE_SAMESITE,
      path: REFRESH_COOKIE_PATH,
      ...(env.AUTH_COOKIE_DOMAIN ? { domain: env.AUTH_COOKIE_DOMAIN } : {}),
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    },
  };
}

/** Reads one cookie from the Cookie header without a parsing middleware. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      const raw = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

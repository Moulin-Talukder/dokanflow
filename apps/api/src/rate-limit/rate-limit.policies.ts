import { createHash } from 'node:crypto';
import { normalizeBdPhone } from '@dokanflow/shared';
import type { Request } from 'express';

/**
 * Fixed-window limits, counted separately per client IP and per identifier
 * (account, email, phone, session or target user). Every attempt counts, whether
 * it succeeds or not. Phase 7 extends this to the rest of the API.
 */
export interface RateLimitPolicy {
  windowSeconds: number;
  perIp: number;
  perIdentifier: number;
  /** The value to limit per identifier, or null when the request carries none. */
  identifier: (req: Request, refreshToken: string | undefined) => string | null;
}

function bodyField(req: Request, field: string): string | null {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Normalized the same way login looks accounts up, so spelling variants share a counter. */
export function normalizeLoginIdentifier(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.includes('@')) return trimmed;
  return normalizeBdPhone(trimmed) ?? trimmed;
}

export type RateLimitPolicyName =
  'login' | 'register' | 'refresh' | 'changePassword' | 'staffResetPassword';

export const RATE_LIMIT_POLICIES: Readonly<Record<RateLimitPolicyName, RateLimitPolicy>> = {
  login: {
    windowSeconds: 15 * 60,
    perIp: 50,
    perIdentifier: 10,
    identifier: (req) => normalizeLoginIdentifier(bodyField(req, 'identifier')),
  },
  register: {
    windowSeconds: 60 * 60,
    perIp: 10,
    perIdentifier: 5,
    identifier: (req) => bodyField(req, 'email')?.trim().toLowerCase() ?? null,
  },
  refresh: {
    windowSeconds: 60,
    perIp: 120,
    perIdentifier: 10,
    identifier: (_req, refreshToken) =>
      refreshToken ? createHash('sha256').update(refreshToken).digest('hex') : null,
  },
  changePassword: {
    windowSeconds: 15 * 60,
    perIp: 30,
    perIdentifier: 5,
    identifier: (req) => req.auth?.userId ?? null,
  },
  staffResetPassword: {
    windowSeconds: 60 * 60,
    perIp: 30,
    perIdentifier: 5,
    identifier: (req) => {
      const target = req.params.userId;
      return typeof target === 'string' ? target : null;
    },
  },
};

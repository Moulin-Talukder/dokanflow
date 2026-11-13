import type { Request } from 'express';
import type { ClientMeta } from './refresh-token.js';

/** Recorded on refresh tokens to help users and admins recognise sessions. */
export function clientMeta(req: Request): ClientMeta {
  const userAgent = req.headers['user-agent'];
  return { userAgent: typeof userAgent === 'string' ? userAgent : null, ip: req.ip ?? null };
}

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept caller-supplied ids (e.g. from a load balancer) only if they are short and safe to log.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Reuses a safe incoming x-request-id or generates one, and echoes it in the response. */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

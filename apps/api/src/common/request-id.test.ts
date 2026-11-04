import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id.js';

function exchange(requestIdHeader?: string): { req: IncomingMessage; res: ServerResponse } {
  const req = new IncomingMessage(new Socket());
  if (requestIdHeader !== undefined) {
    req.headers['x-request-id'] = requestIdHeader;
  }
  return { req, res: new ServerResponse(req) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it('reuses a safe incoming id and echoes it', () => {
    const { req, res } = exchange('lb-1234.abc_def');
    expect(resolveRequestId(req, res)).toBe('lb-1234.abc_def');
    expect(res.getHeader('x-request-id')).toBe('lb-1234.abc_def');
  });

  it('generates a UUID when none is supplied', () => {
    const { req, res } = exchange();
    const id = resolveRequestId(req, res);
    expect(id).toMatch(UUID);
    expect(res.getHeader('x-request-id')).toBe(id);
  });

  it.each(['has spaces', 'new\nline', 'x'.repeat(129), ''])(
    'replaces an unsafe incoming id (%j)',
    (unsafe) => {
      const { req, res } = exchange(unsafe);
      expect(resolveRequestId(req, res)).toMatch(UUID);
    },
  );
});

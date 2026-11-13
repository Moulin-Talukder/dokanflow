import type { AuthResponse, Session } from '@dokanflow/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../api-error';
import { AuthClient } from './auth-client';

const session: Session = {
  user: {
    id: '6a1d2c3b-4e5f-4a7b-8c9d-0e1f2a3b4c5d',
    name: 'Rahim',
    email: 'rahim@example.com',
    phone: null,
    mustChangePassword: false,
  },
  tenant: { id: '0b6f1c8e-9a1d-4a53-8f0e-5e2b4d3c2a10', name: 'Rahim Store' },
  role: 'owner',
  permissions: ['tenant:read', 'staff:read', 'staff:create', 'staff:reset-password'],
  memberships: [
    { tenantId: '0b6f1c8e-9a1d-4a53-8f0e-5e2b4d3c2a10', tenantName: 'Rahim Store', role: 'owner' },
  ],
};

function auth(token: string): AuthResponse {
  return { accessToken: token, expiresIn: 900, session };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function urlOf(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function setup(handler: Handler) {
  const fetchImpl = vi.fn<typeof fetch>((input, init) =>
    Promise.resolve(handler(urlOf(input), init ?? {})),
  );
  const sessions: (Session | null)[] = [];
  const client = new AuthClient({
    baseUrl: 'http://api.test/api',
    fetchImpl,
    onSessionChange: (s) => sessions.push(s),
    lock: (_name, fn) => fn(),
  });
  return { client, fetchImpl, sessions };
}

const headersOf = (init: RequestInit | undefined): Record<string, string> =>
  (init?.headers ?? {}) as Record<string, string>;

describe('AuthClient', () => {
  it('refreshes with the cookie (credentials included) and the CSRF header', async () => {
    const { client, fetchImpl, sessions } = setup(() => Response.json(auth('t1')));
    expect(await client.refresh()).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://api.test/api/auth/refresh');
    expect(init?.credentials).toBe('include');
    expect(headersOf(init)['x-dokanflow-csrf']).toBe('1');
    expect(sessions).toEqual([session]);
  });

  it('sends the CSRF header and credentials on login and register', async () => {
    const { client, fetchImpl } = setup(() => Response.json(auth('t1')));
    await client.login({ identifier: 'rahim@example.com', password: 'x' });
    await client.register({
      businessName: 'Shop',
      name: 'Rahim',
      email: 'rahim@example.com',
      password: 'a-long-password',
    });
    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.credentials).toBe('include');
      expect(headersOf(init)['x-dokanflow-csrf']).toBe('1');
    }
  });

  it('shares one refresh between concurrent callers', async () => {
    let resolve: (r: Response) => void = () => undefined;
    const { client, fetchImpl } = setup(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    );
    const results = Promise.all([client.refresh(), client.refresh(), client.refresh()]);
    resolve(Response.json(auth('t1')));
    expect(await results).toEqual([true, true, true]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports no session (and clears it) when the refresh is rejected', async () => {
    const { client, sessions } = setup(() => Response.json({}, { status: 401 }));
    expect(await client.refresh()).toBe(false);
    expect(client.isAuthenticated).toBe(false);
    expect(sessions).toEqual([null]);
  });

  it('sends the access token and transparently refreshes once on 401', async () => {
    let calls = 0;
    const { client, fetchImpl } = setup((url, init) => {
      if (url.endsWith('/auth/login')) return Response.json(auth('old'));
      if (url.endsWith('/auth/refresh')) return Response.json(auth('new'));
      calls += 1;
      const token = headersOf(init).authorization;
      return token === 'Bearer new'
        ? Response.json({ ok: true })
        : Response.json({}, { status: 401 });
    });
    await client.login({ identifier: 'rahim@example.com', password: 'x' });

    expect(await client.request('GET', '/staff')).toBeUndefined();
    expect(calls).toBe(2);
    expect(fetchImpl.mock.calls.map(([u]) => urlOf(u).replace('http://api.test/api', ''))).toEqual([
      '/auth/login',
      '/staff',
      '/auth/refresh',
      '/staff',
    ]);
  });

  it('signs out when the refresh after a 401 also fails', async () => {
    const { client, sessions } = setup((url) =>
      url.endsWith('/auth/login') ? Response.json(auth('t')) : Response.json({}, { status: 401 }),
    );
    await client.login({ identifier: 'a@b.c', password: 'x' });
    await expect(client.request('GET', '/staff')).rejects.toBeInstanceOf(ApiRequestError);
    expect(client.isAuthenticated).toBe(false);
    expect(sessions.at(-1)).toBeNull();
  });

  it('does not refresh on 403 (a permission problem, not an expired token)', async () => {
    const { client, fetchImpl } = setup((url) =>
      url.endsWith('/auth/login')
        ? Response.json(auth('t'))
        : Response.json(
            { error: { statusCode: 403, code: 'FORBIDDEN', message: 'No' } },
            { status: 403 },
          ),
    );
    await client.login({ identifier: 'a@b.c', password: 'x' });
    await expect(client.request('POST', '/staff', { body: {} })).rejects.toMatchObject({
      status: 403,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('clears the session on logout even if the network fails', async () => {
    const { client, sessions } = setup((url) => {
      if (url.endsWith('/auth/login')) return Response.json(auth('t'));
      throw new TypeError('network down');
    });
    await client.login({ identifier: 'a@b.c', password: 'x' });
    await expect(client.logout()).rejects.toThrow('network down');
    expect(client.isAuthenticated).toBe(false);
    expect(sessions.at(-1)).toBeNull();
  });
});

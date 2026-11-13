import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema } from '@dokanflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/infra/prisma.service.js';
import { RedisService } from '../src/infra/redis.service.js';
import { RATE_LIMIT_POLICIES } from '../src/rate-limit/rate-limit.policies.js';
import {
  CSRF,
  createTestApp,
  login,
  refreshCookie,
  registerOwner,
  resetRateLimits,
  type TestApp,
  toSession,
  uniqueEmail,
  uniquePhone,
} from './helpers.js';

/**
 * Integration tests for the Phase 2 security review fixes, against real Postgres
 * (sessions, revocation, managed accounts) and real Redis (rate limits).
 */
describe('security review fixes (integration)', () => {
  let testApp: TestApp;
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;

  beforeAll(async () => {
    testApp = await createTestApp();
    ({ app, server } = testApp);
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetRateLimits(testApp);
  });

  afterAll(async () => {
    await app.close();
  });

  const bearer = (token: string): [string, string] => ['authorization', `Bearer ${token}`];

  async function createCashier(ownerToken: string) {
    const phone = uniquePhone();
    const temporaryPassword = `temp-${randomUUID()}`;
    const res = await request(server)
      .post('/api/staff')
      .set(...bearer(ownerToken))
      .send({ role: 'cashier', name: 'Cashier', phone, temporaryPassword })
      .expect(201);
    return { userId: (res.body as { userId: string }).userId, phone, temporaryPassword };
  }

  describe('CSRF header on login and register (finding 12)', () => {
    it('refuses login and register without the header', async () => {
      const owner = await registerOwner(server, 'csrf-login');
      await request(server)
        .post('/api/auth/login')
        .send({ identifier: owner.email, password: owner.password })
        .expect(403);
      await request(server)
        .post('/api/auth/register')
        .send({
          businessName: 'X',
          name: 'X',
          email: uniqueEmail('x'),
          password: 'long-password-1',
        })
        .expect(403);
      await request(server)
        .post('/api/auth/login')
        .set(CSRF)
        .set('origin', 'https://evil.example')
        .send({ identifier: owner.email, password: owner.password })
        .expect(403);
    });
  });

  describe('revoked sessions reject access tokens at once (findings 4, 10, 11)', () => {
    it('logout invalidates the access token immediately', async () => {
      const owner = await registerOwner(server, 'logout-at');
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(owner.accessToken))
        .expect(200);
      await request(server)
        .post('/api/auth/logout')
        .set(CSRF)
        .set('cookie', owner.cookie)
        .expect(204);
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(owner.accessToken))
        .expect(401);
    });

    it('refresh-token reuse cuts off the access tokens of everyone in that session', async () => {
      const owner = await registerOwner(server, 'reuse-at');
      // The thief refreshes first and gets an access token...
      const thief = toSession(
        await request(server)
          .post('/api/auth/refresh')
          .set(CSRF)
          .set('cookie', owner.cookie)
          .expect(200),
      );
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(thief.accessToken))
        .expect(200);
      // ...then the victim's replay of the same token is detected as reuse.
      await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', owner.cookie)
        .expect(401);
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(thief.accessToken))
        .expect(401);
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(owner.accessToken))
        .expect(401);
    });

    it('a reset in the same second as the login still rejects that login’s token', async () => {
      const owner = await registerOwner(server, 'same-second');
      const cashier = await createCashier(owner.accessToken);
      const session = await login(server, cashier.phone, cashier.temporaryPassword);
      // No delay: under the old timestamp check this token could survive.
      await request(server)
        .post(`/api/staff/${cashier.userId}/reset-password`)
        .set(...bearer(owner.accessToken))
        .send({ temporaryPassword: 'fresh-temporary-1' })
        .expect(204);
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(session.accessToken))
        .expect(401);
    });

    it('tokens work immediately after registration (no database/API clock comparison)', async () => {
      const owner = await registerOwner(server, 'no-skew');
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(owner.accessToken))
        .expect(200);
      const stored = await prisma.client.authSession.findMany({
        where: { userId: owner.body.session.user.id },
      });
      expect(stored).toHaveLength(1);
    });
  });

  describe('absolute session lifetime (finding 6)', () => {
    it('fixes the session end at login; rotation never extends it', async () => {
      const owner = await registerOwner(server, 'lifetime');
      const userId = owner.body.session.user.id;
      const [session] = await prisma.client.authSession.findMany({ where: { userId } });
      if (!session) throw new Error('expected a session');

      let cookie = owner.cookie;
      for (let i = 0; i < 3; i++) {
        const res = await request(server)
          .post('/api/auth/refresh')
          .set(CSRF)
          .set('cookie', cookie)
          .expect(200);
        cookie = toSession(res).cookie;
      }

      const after = await prisma.client.authSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      expect(after.expiresAt).toEqual(session.expiresAt);
      const tokens = await prisma.client.refreshToken.findMany({
        where: { sessionId: session.id },
      });
      expect(tokens).toHaveLength(4);
      for (const token of tokens) {
        expect(token.expiresAt.getTime()).toBeLessThanOrEqual(session.expiresAt.getTime());
      }
    });
  });

  describe('refresh cookie (finding 13)', () => {
    it('uses Path=/ and refuses duplicate refresh cookies', async () => {
      const owner = await registerOwner(server, 'dup-cookie');
      const res = await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', `${owner.cookie}; dokanflow_rt=planted-by-a-subdomain`)
        .expect(400);
      expect(apiErrorSchema.parse(res.body).error.message).toBe('Duplicate session cookies');
      const cleared = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(cleared).toMatch(/dokanflow_rt=;.*Path=\/;/);
      expect(cleared).toMatch(/dokanflow_rt=;.*Path=\/api\/auth/);
      expect(refreshCookie(res)).toBe('dokanflow_rt=');
    });
  });

  describe('password reset uses one fixed context (finding 20)', () => {
    it('a staff account that starts its own business is no longer managed by the shop', async () => {
      const owner = await registerOwner(server, 'managed');
      const cashier = await createCashier(owner.accessToken);
      expect(
        (await prisma.client.user.findUniqueOrThrow({ where: { id: cashier.userId } }))
          .managedByTenantId,
      ).toBe(owner.body.session.tenant.id);

      const first = await login(server, cashier.phone, cashier.temporaryPassword);
      const changed = toSession(
        await request(server)
          .post('/api/auth/change-password')
          .set(...bearer(first.accessToken))
          .send({ currentPassword: cashier.temporaryPassword, newPassword: 'cashier-own-pass' })
          .expect(200),
      );
      await request(server)
        .post('/api/tenants')
        .set(...bearer(changed.accessToken))
        .send({ businessName: 'Side Business' })
        .expect(201);

      expect(
        (await prisma.client.user.findUniqueOrThrow({ where: { id: cashier.userId } }))
          .managedByTenantId,
      ).toBeNull();
      await request(server)
        .post(`/api/staff/${cashier.userId}/reset-password`)
        .set(...bearer(owner.accessToken))
        .send({ temporaryPassword: 'takeover-attempt' })
        .expect(403);
    });
  });
});

describe('rate limiting with real Redis (finding 2)', () => {
  let testApp: TestApp;
  let app: INestApplication;
  let server: Server;
  let redis: RedisService;
  let prefix: string;
  /** Limited by the first test; used to prove the next test starts from zero. */
  let limitedOwner: Awaited<ReturnType<typeof registerOwner>>;

  beforeAll(async () => {
    testApp = await createTestApp({ RATE_LIMIT_SCALE: '1' });
    ({ app, server } = testApp);
    prefix = testApp.env.RATE_LIMIT_KEY_PREFIX;
    redis = app.get(RedisService);
  });

  beforeEach(async () => {
    await resetRateLimits(testApp);
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks an identifier after its limit, with Retry-After, without blocking others', async () => {
    const owner = await registerOwner(server, 'limited');
    limitedOwner = owner;
    const attempts = RATE_LIMIT_POLICIES.login.perIdentifier;
    for (let i = 0; i < attempts; i++) {
      await request(server)
        .post('/api/auth/login')
        .set(CSRF)
        .send({ identifier: owner.email, password: 'wrong-password' })
        .expect(401);
    }
    // Even the right password is refused now: the limit counts attempts.
    const blocked = await request(server)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: owner.email.toUpperCase(), password: owner.password })
      .expect(429);
    expect(apiErrorSchema.parse(blocked.body).error.code).toBe('TOO_MANY_REQUESTS');
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(RATE_LIMIT_POLICIES.login.windowSeconds);

    // Another account from the same IP is unaffected (well under the per-IP limit).
    const other = await registerOwner(server, 'unlimited');
    await login(server, other.email, other.password);
  });

  it('starts every test with fresh counters (no leaks between tests)', async () => {
    // The previous test locked this account; beforeEach cleared this app's counters.
    expect(await redis.client.keys(`${prefix}:*`)).toEqual([]);
    await login(server, limitedOwner.email, limitedOwner.password);
  });

  it('keeps counters in Redis with an expiry, keyed by hashes not raw identifiers', async () => {
    const owner = await registerOwner(server, 'counters');
    await request(server)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ identifier: owner.email, password: 'wrong-password' })
      .expect(401);
    const keys = await redis.client.keys(`${prefix}:login:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).not.toContain('@');
      expect(await redis.client.pttl(key)).toBeGreaterThan(0);
    }
  });

  it('limits change-password per account', async () => {
    const owner = await registerOwner(server, 'cp-limit');
    for (let i = 0; i < RATE_LIMIT_POLICIES.changePassword.perIdentifier; i++) {
      await request(server)
        .post('/api/auth/change-password')
        .set(...(['authorization', `Bearer ${owner.accessToken}`] as [string, string]))
        .send({ currentPassword: 'not-it-at-all', newPassword: 'brand-new-password' })
        .expect(400);
    }
    await request(server)
      .post('/api/auth/change-password')
      .set('authorization', `Bearer ${owner.accessToken}`)
      .send({ currentPassword: owner.password, newPassword: 'brand-new-password' })
      .expect(429);
  });
});

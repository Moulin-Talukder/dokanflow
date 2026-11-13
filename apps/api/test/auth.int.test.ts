import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { apiErrorSchema, sessionSchema, staffListResponseSchema } from '@dokanflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CSRF,
  createTestApp,
  login,
  refreshCookie,
  registerOwner,
  toSession,
  uniqueEmail,
  uniquePhone,
} from './helpers.js';

/**
 * End-to-end auth, tenancy and RBAC against real Postgres (with RLS) and Redis.
 * Every flow goes through HTTP, guards, services and the database.
 */
describe('auth, tenants and RBAC (integration)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    ({ app, server } = await createTestApp());
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

  async function createManager(ownerToken: string) {
    const email = uniqueEmail('manager');
    const temporaryPassword = `temp-${randomUUID()}`;
    const res = await request(server)
      .post('/api/staff')
      .set(...bearer(ownerToken))
      .send({ role: 'manager', name: 'Manager', email, temporaryPassword })
      .expect(201);
    return { userId: (res.body as { userId: string }).userId, email, temporaryPassword };
  }

  describe('registration and login', () => {
    it('creates an owner, a business and an httpOnly refresh cookie', async () => {
      const res = await request(server)
        .post('/api/auth/register')
        .set(CSRF)
        .send({
          businessName: 'Rahim Store',
          name: 'Rahim',
          email: uniqueEmail('Reg').toUpperCase(),
          password: 'a-long-password',
        })
        .expect(201);

      const cookieHeader = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(cookieHeader).toMatch(/dokanflow_rt=[\w-]+;/);
      expect(cookieHeader).toMatch(/HttpOnly/);
      expect(cookieHeader).toMatch(/Path=\/;/);
      expect(cookieHeader).toMatch(/Expires=/);
      expect(cookieHeader).toMatch(/SameSite=Strict/);
      expect(res.headers['cache-control']).toBe('no-store');

      const { session } = toSession(res).body;
      expect(session.role).toBe('owner');
      expect(session.tenant.name).toBe('Rahim Store');
      expect(session.user.email).toMatch(/^reg-.*@test\.dokanflow\.local$/); // normalized
      expect(session.permissions).toContain('staff:create');
    });

    it('refuses a second registration with the same email', async () => {
      const owner = await registerOwner(server, 'dup');
      await request(server)
        .post('/api/auth/register')
        .set(CSRF)
        .send({ businessName: 'X', name: 'X', email: owner.email, password: 'another-password' })
        .expect(409);
    });

    it('gives the same 401 for an unknown user and a wrong password', async () => {
      const owner = await registerOwner(server, 'login');
      const wrong = await request(server)
        .post('/api/auth/login')
        .set(CSRF)
        .send({ identifier: owner.email, password: 'wrong-password' })
        .expect(401);
      const unknown = await request(server)
        .post('/api/auth/login')
        .set(CSRF)
        .send({ identifier: uniqueEmail('nobody'), password: 'wrong-password' })
        .expect(401);
      expect(apiErrorSchema.parse(wrong.body).error.message).toBe(
        apiErrorSchema.parse(unknown.body).error.message,
      );
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the cookie and issues a working access token', async () => {
      const owner = await registerOwner(server, 'rotate');
      const res = await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', owner.cookie)
        .expect(200);
      const next = toSession(res);
      expect(next.cookie).not.toBe(owner.cookie);
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(next.accessToken))
        .expect(200);
    });

    it('revokes the whole session when an old refresh token is reused', async () => {
      const owner = await registerOwner(server, 'reuse');
      const rotated = toSession(
        await request(server)
          .post('/api/auth/refresh')
          .set(CSRF)
          .set('cookie', owner.cookie)
          .expect(200),
      );

      // Replay of the already-rotated token: rejected, and the cookie is cleared.
      const replay = await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', owner.cookie)
        .expect(401);
      expect(refreshCookie(replay)).toMatch(/^dokanflow_rt=$/);

      // The legitimate, newer token is revoked too.
      await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', rotated.cookie)
        .expect(401);
    });

    it('serializes concurrent refreshes of the same token', async () => {
      const owner = await registerOwner(server, 'race');
      const results = await Promise.all(
        [1, 2].map(() =>
          request(server).post('/api/auth/refresh').set(CSRF).set('cookie', owner.cookie),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('requires the CSRF header and an allowed origin', async () => {
      const owner = await registerOwner(server, 'csrf');
      await request(server).post('/api/auth/refresh').set('cookie', owner.cookie).expect(403);
      await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('origin', 'https://evil.example')
        .set('cookie', owner.cookie)
        .expect(403);
      // The rejected attempts did not consume the token.
      await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('origin', 'http://localhost:3000')
        .set('cookie', owner.cookie)
        .expect(200);
    });

    it('ends the session on logout', async () => {
      const owner = await registerOwner(server, 'logout');
      await request(server)
        .post('/api/auth/logout')
        .set(CSRF)
        .set('cookie', owner.cookie)
        .expect(204);
      await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', owner.cookie)
        .expect(401);
    });
  });

  describe('staff accounts and first-login password change', () => {
    it('lets a cashier sign in by phone and forces a password change first', async () => {
      const owner = await registerOwner(server, 'staff');
      const cashier = await createCashier(owner.accessToken);

      // Any spelling of the phone works; it is normalized.
      const first = await login(server, `+88${cashier.phone}`, cashier.temporaryPassword);
      expect(first.body.session.user.mustChangePassword).toBe(true);
      expect(first.body.session.user.phone).toBe(`+88${cashier.phone}`);

      const blocked = await request(server)
        .get('/api/staff')
        .set(...bearer(first.accessToken))
        .expect(403);
      expect(apiErrorSchema.parse(blocked.body).error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(first.accessToken))
        .expect(200);

      const changed = toSession(
        await request(server)
          .post('/api/auth/change-password')
          .set(...bearer(first.accessToken))
          .send({ currentPassword: cashier.temporaryPassword, newPassword: 'my-own-password' })
          .expect(200),
      );
      expect(changed.body.session.user.mustChangePassword).toBe(false);

      // The pre-change access token and refresh cookie are dead.
      await request(server)
        .get('/api/auth/me')
        .set(...bearer(first.accessToken))
        .expect(401);
      await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', first.cookie)
        .expect(401);

      // Now past the gate, the cashier hits the role check instead.
      const forbidden = await request(server)
        .get('/api/staff')
        .set(...bearer(changed.accessToken))
        .expect(403);
      expect(apiErrorSchema.parse(forbidden.body).error.code).toBe('FORBIDDEN');

      await login(server, cashier.phone, 'my-own-password');
    });

    it('rejects a wrong current password', async () => {
      const owner = await registerOwner(server, 'wrongcur');
      const res = await request(server)
        .post('/api/auth/change-password')
        .set(...bearer(owner.accessToken))
        .send({ currentPassword: 'not-it-at-all', newPassword: 'brand-new-password' })
        .expect(400);
      expect(apiErrorSchema.parse(res.body).error.issues?.[0]?.path).toBe('currentPassword');
    });

    it('refuses staff whose email or phone already belongs to someone', async () => {
      const owner = await registerOwner(server, 'dupstaff');
      const other = await registerOwner(server, 'existing');
      await request(server)
        .post('/api/staff')
        .set(...bearer(owner.accessToken))
        .send({
          role: 'manager',
          name: 'M',
          email: other.email,
          temporaryPassword: 'temporary-123',
        })
        .expect(409);

      const cashier = await createCashier(owner.accessToken);
      await request(server)
        .post('/api/staff')
        .set(...bearer(owner.accessToken))
        .send({
          role: 'cashier',
          name: 'C',
          phone: cashier.phone,
          temporaryPassword: 'temporary-123',
        })
        .expect(409);
    });
  });

  describe('role permissions', () => {
    it('owner manages staff; manager reads; cashier does neither', async () => {
      const owner = await registerOwner(server, 'roles');
      const manager = await createManager(owner.accessToken);
      const cashier = await createCashier(owner.accessToken);

      const asManager = toSession(
        await request(server)
          .post('/api/auth/change-password')
          .set(
            ...bearer((await login(server, manager.email, manager.temporaryPassword)).accessToken),
          )
          .send({ currentPassword: manager.temporaryPassword, newPassword: 'manager-password' })
          .expect(200),
      );
      const asCashier = toSession(
        await request(server)
          .post('/api/auth/change-password')
          .set(
            ...bearer((await login(server, cashier.phone, cashier.temporaryPassword)).accessToken),
          )
          .send({ currentPassword: cashier.temporaryPassword, newPassword: 'cashier-password' })
          .expect(200),
      );

      const list = await request(server)
        .get('/api/staff')
        .set(...bearer(asManager.accessToken))
        .expect(200);
      expect(staffListResponseSchema.parse(list.body).items).toHaveLength(3);

      const newStaff = {
        role: 'cashier',
        name: 'X',
        phone: uniquePhone(),
        temporaryPassword: 'temporary-123',
      };
      await request(server)
        .post('/api/staff')
        .set(...bearer(asManager.accessToken))
        .send(newStaff)
        .expect(403);
      await request(server)
        .post('/api/staff')
        .set(...bearer(asCashier.accessToken))
        .send(newStaff)
        .expect(403);
      await request(server)
        .get('/api/staff')
        .set(...bearer(asCashier.accessToken))
        .expect(403);
      await request(server)
        .post(`/api/staff/${cashier.userId}/reset-password`)
        .set(...bearer(asManager.accessToken))
        .send({ temporaryPassword: 'temporary-123' })
        .expect(403);
    });
  });

  describe('owner password reset', () => {
    it("forces a new password and ends the staff member's sessions", async () => {
      const owner = await registerOwner(server, 'reset');
      const cashier = await createCashier(owner.accessToken);
      const session = await login(server, cashier.phone, cashier.temporaryPassword);

      await request(server)
        .post(`/api/staff/${cashier.userId}/reset-password`)
        .set(...bearer(owner.accessToken))
        .send({ temporaryPassword: 'fresh-temporary-1' })
        .expect(204);

      await request(server)
        .get('/api/auth/me')
        .set(...bearer(session.accessToken))
        .expect(401);
      await request(server)
        .post('/api/auth/refresh')
        .set(CSRF)
        .set('cookie', session.cookie)
        .expect(401);
      const again = await login(server, cashier.phone, 'fresh-temporary-1');
      expect(again.body.session.user.mustChangePassword).toBe(true);
    });

    it('cannot reset the owner, or someone who also belongs to another shop', async () => {
      const owner = await registerOwner(server, 'resetrules');
      await request(server)
        .post(`/api/staff/${owner.body.session.user.id}/reset-password`)
        .set(...bearer(owner.accessToken))
        .send({ temporaryPassword: 'temporary-123' })
        .expect(403);

      // The cashier starts their own business, so the account is no longer only this shop's.
      const cashier = await createCashier(owner.accessToken);
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

      await request(server)
        .post(`/api/staff/${cashier.userId}/reset-password`)
        .set(...bearer(owner.accessToken))
        .send({ temporaryPassword: 'takeover-attempt' })
        .expect(403);
      await login(server, cashier.phone, 'cashier-own-pass'); // still their password
    });
  });

  describe('multiple shops', () => {
    it('creates a second business and switches the session to it', async () => {
      const owner = await registerOwner(server, 'multi');
      const created = await request(server)
        .post('/api/tenants')
        .set(...bearer(owner.accessToken))
        .send({ businessName: 'Second Shop' })
        .expect(201);
      const { tenantId } = created.body as { tenantId: string };

      const switched = toSession(
        await request(server)
          .post('/api/auth/switch-tenant')
          .set(CSRF)
          .set(...bearer(owner.accessToken))
          .set('cookie', owner.cookie)
          .send({ tenantId })
          .expect(200),
      );
      expect(switched.body.session.tenant).toEqual({ id: tenantId, name: 'Second Shop' });
      expect(switched.body.session.memberships).toHaveLength(2);

      const staff = await request(server)
        .get('/api/staff')
        .set(...bearer(switched.accessToken))
        .expect(200);
      expect(staffListResponseSchema.parse(staff.body).items).toHaveLength(1);

      // The next login lands in the last shop used.
      const again = await login(server, owner.email, owner.password);
      expect(again.body.session.tenant.id).toBe(tenantId);
    });
  });

  describe('cross-tenant access', () => {
    it("never exposes or changes another shop's data", async () => {
      const shopA = await registerOwner(server, 'tenant-a');
      const shopB = await registerOwner(server, 'tenant-b');
      const cashierA = await createCashier(shopA.accessToken);

      // B's staff list contains only B's owner.
      const listB = await request(server)
        .get('/api/staff')
        .set(...bearer(shopB.accessToken))
        .expect(200);
      const idsB = staffListResponseSchema.parse(listB.body).items.map((m) => m.userId);
      expect(idsB).toEqual([shopB.body.session.user.id]);

      // B's owner cannot reset A's cashier: the member is invisible, so 404.
      await request(server)
        .post(`/api/staff/${cashierA.userId}/reset-password`)
        .set(...bearer(shopB.accessToken))
        .send({ temporaryPassword: 'takeover-attempt' })
        .expect(404);
      await login(server, cashierA.phone, cashierA.temporaryPassword); // unchanged

      // B's owner cannot switch into A.
      await request(server)
        .post('/api/auth/switch-tenant')
        .set(CSRF)
        .set(...bearer(shopB.accessToken))
        .set('cookie', shopB.cookie)
        .send({ tenantId: shopA.body.session.tenant.id })
        .expect(403);

      // A's session only lists A.
      const me = await request(server)
        .get('/api/auth/me')
        .set(...bearer(shopA.accessToken))
        .expect(200);
      expect(sessionSchema.parse(me.body).memberships.map((m) => m.tenantId)).toEqual([
        shopA.body.session.tenant.id,
      ]);
    });

    it("rejects B's refresh cookie when switching with A's access token", async () => {
      const shopA = await registerOwner(server, 'mix-a');
      const shopB = await registerOwner(server, 'mix-b');
      await request(server)
        .post('/api/auth/switch-tenant')
        .set(CSRF)
        .set(...bearer(shopA.accessToken))
        .set('cookie', shopB.cookie)
        .send({ tenantId: shopA.body.session.tenant.id })
        .expect(401);
    });
  });
});

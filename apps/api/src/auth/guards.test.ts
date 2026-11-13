import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Controller, Get, type INestApplication, Post, UseGuards } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, type MembershipRole } from '@dokanflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { ApiExpressAdapter } from '../common/api-express.adapter.js';
import { APP_CONFIG } from '../config/config.module.js';
import { AccessTokenService } from './access-token.service.js';
import type { AuthContext } from './auth-context.js';
import { CsrfGuard } from './csrf.guard.js';
import {
  AllowWhilePasswordChangeRequired,
  CurrentAuth,
  Public,
  RequirePermission,
} from './decorators.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { MembershipLookup, type MembershipLookupResult } from './membership.lookup.js';
import { PermissionsGuard } from './permissions.guard.js';
import { TenantContextGuard } from './tenant-context.guard.js';
import { testEnv } from './test-env.js';

@Controller('probe')
class ProbeController {
  @Public()
  @Get('public')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('me')
  me(@CurrentAuth() auth: AuthContext): AuthContext {
    return auth;
  }

  @AllowWhilePasswordChangeRequired()
  @Get('allowed-during-password-change')
  allowed(): { ok: true } {
    return { ok: true };
  }

  @RequirePermission('staff:read')
  @Get('staff')
  readStaff(): { ok: true } {
    return { ok: true };
  }

  @RequirePermission('staff:create')
  @Post('staff')
  createStaff(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('cookie-endpoint')
  cookieEndpoint(): { ok: true } {
    return { ok: true };
  }
}

/** Stands in for the database query; keyed by `${userId}:${tenantId}`. */
class FakeMembershipLookup {
  rows = new Map<string, MembershipLookupResult>();
  find(userId: string, tenantId: string): Promise<MembershipLookupResult | null> {
    return Promise.resolve(this.rows.get(`${userId}:${tenantId}`) ?? null);
  }
}

describe('auth guard chain (HTTP)', () => {
  const env = testEnv();
  const tokens = new AccessTokenService(env);
  const lookup = new FakeMembershipLookup();
  let app: INestApplication;
  let server: Server;

  const userId = randomUUID();
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  function member(role: MembershipRole, extra: Partial<MembershipLookupResult> = {}): void {
    lookup.rows.set(`${userId}:${tenantA}`, {
      role,
      mustChangePassword: false,
      passwordChangedAt: new Date('2026-01-01T00:00:00Z'),
      userStatus: 'active',
      tenantStatus: 'active',
      ...extra,
    });
  }

  function bearer(tenantId = tenantA): Promise<string> {
    return tokens
      .sign({ userId, tenantId, sessionId: randomUUID() })
      .then((token) => `Bearer ${token}`);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: APP_CONFIG, useValue: env },
        { provide: AccessTokenService, useValue: tokens },
        { provide: MembershipLookup, useValue: lookup },
        CsrfGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: TenantContextGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication(new ApiExpressAdapter(), { logger: false });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    lookup.rows.clear();
  });

  describe('authentication', () => {
    it('lets @Public routes through without a token', async () => {
      await request(server).get('/probe/public').expect(200);
    });

    it('rejects a missing or malformed bearer token with 401', async () => {
      await request(server).get('/probe/me').expect(401);
      await request(server).get('/probe/me').set('authorization', 'Bearer nope').expect(401);
      await request(server).get('/probe/me').set('authorization', 'Basic abc').expect(401);
    });

    it('resolves the auth context from the database, not just the token', async () => {
      member('manager');
      const res = await request(server)
        .get('/probe/me')
        .set('authorization', await bearer())
        .expect(200);
      expect(res.body).toMatchObject({ userId, tenantId: tenantA, role: 'manager' });
    });
  });

  describe('tenant context', () => {
    it('rejects a valid token for a shop the user does not belong to', async () => {
      member('owner'); // member of A only
      await request(server)
        .get('/probe/me')
        .set('authorization', await bearer(tenantB))
        .expect(401);
    });

    it('rejects tokens of disabled users and suspended shops', async () => {
      member('owner', { userStatus: 'disabled' });
      await request(server)
        .get('/probe/me')
        .set('authorization', await bearer())
        .expect(401);
      member('owner', { tenantStatus: 'suspended' });
      await request(server)
        .get('/probe/me')
        .set('authorization', await bearer())
        .expect(401);
    });

    it('rejects tokens issued before the last password change or reset', async () => {
      const token = await bearer();
      member('owner', { passwordChangedAt: new Date(Date.now() + 2000) });
      await request(server).get('/probe/me').set('authorization', token).expect(401);
    });
  });

  describe('first-login password change', () => {
    it('blocks ordinary routes with PASSWORD_CHANGE_REQUIRED', async () => {
      member('cashier', { mustChangePassword: true });
      const res = await request(server)
        .get('/probe/me')
        .set('authorization', await bearer())
        .expect(403);
      expect(apiErrorSchema.parse(res.body).error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('allows routes marked @AllowWhilePasswordChangeRequired', async () => {
      member('cashier', { mustChangePassword: true });
      await request(server)
        .get('/probe/allowed-during-password-change')
        .set('authorization', await bearer())
        .expect(200);
    });

    it('checks the password change before permissions', async () => {
      member('owner', { mustChangePassword: true });
      const res = await request(server)
        .post('/probe/staff')
        .set('authorization', await bearer())
        .expect(403);
      expect(apiErrorSchema.parse(res.body).error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });
  });

  describe('role permissions', () => {
    const cases: [MembershipRole, string, string, number][] = [
      ['owner', 'GET', '/probe/staff', 200],
      ['owner', 'POST', '/probe/staff', 201],
      ['manager', 'GET', '/probe/staff', 200],
      ['manager', 'POST', '/probe/staff', 403],
      ['cashier', 'GET', '/probe/staff', 403],
      ['cashier', 'POST', '/probe/staff', 403],
    ];

    it.each(cases)('%s %s %s -> %i', async (role, method, path, status) => {
      member(role);
      const auth = await bearer();
      const req = method === 'GET' ? request(server).get(path) : request(server).post(path);
      const res = await req.set('authorization', auth).expect(status);
      if (status === 403) {
        expect(apiErrorSchema.parse(res.body).error.code).toBe('FORBIDDEN');
      }
    });
  });

  describe('CSRF on cookie endpoints', () => {
    it('requires the custom header', async () => {
      await request(server).post('/probe/cookie-endpoint').expect(403);
    });

    it('rejects a disallowed Origin even with the header', async () => {
      await request(server)
        .post('/probe/cookie-endpoint')
        .set('x-dokanflow-csrf', '1')
        .set('origin', 'https://evil.example')
        .expect(403);
    });

    it('accepts the header from an allowed origin, or with no Origin (non-browser)', async () => {
      await request(server)
        .post('/probe/cookie-endpoint')
        .set('x-dokanflow-csrf', '1')
        .set('origin', 'http://localhost:3000')
        .expect(201);
      await request(server).post('/probe/cookie-endpoint').set('x-dokanflow-csrf', '1').expect(201);
    });
  });
});

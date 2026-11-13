import type { Server } from 'node:http';
import { Body, Controller, type INestApplication, Post, UseGuards } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { apiErrorSchema } from '@dokanflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testEnv } from '../auth/test-env.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';
import { ApiExpressAdapter } from '../common/api-express.adapter.js';
import { APP_CONFIG } from '../config/config.module.js';
import { RATE_LIMIT_STORE, RateLimit, RateLimitGuard } from './rate-limit.guard.js';
import { normalizeLoginIdentifier, RATE_LIMIT_POLICIES } from './rate-limit.policies.js';
import type { HitResult, RateLimitStore } from './rate-limit.store.js';

@Controller('probe')
class ProbeController {
  @UseGuards(RateLimitGuard)
  @RateLimit('login')
  @Post('login')
  login(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }
}

class InMemoryStore implements RateLimitStore {
  counts = new Map<string, number>();
  failing = false;
  hit(key: string, windowMs: number): Promise<HitResult> {
    if (this.failing) return Promise.reject(new Error('redis down'));
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve({ count, ttlMs: windowMs - 1500 });
  }
}

describe('RateLimitGuard (HTTP)', () => {
  const store = new InMemoryStore();
  const { perIp, perIdentifier, windowSeconds } = RATE_LIMIT_POLICIES.login;
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        { provide: APP_CONFIG, useValue: testEnv() },
        { provide: RATE_LIMIT_STORE, useValue: store },
        RateLimitGuard,
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
    store.counts.clear();
    store.failing = false;
  });

  const login = (identifier: string) =>
    request(server).post('/probe/login').send({ identifier, password: 'x' });

  it('allows requests up to the per-identifier limit, then answers 429 with Retry-After', async () => {
    for (let i = 0; i < perIdentifier; i++) {
      await login('01712345678').expect(201);
    }
    const res = await login('01712345678').expect(429);
    expect(apiErrorSchema.parse(res.body).error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(res.headers['retry-after'])).toBe(windowSeconds - 1);
  });

  it('counts spelling variants of the same phone or email together', async () => {
    const variants = ['01712345678', '+8801712345678', '+880 1712-345678', '8801712345678'];
    for (let i = 0; i < perIdentifier; i++) {
      await login(variants[i % variants.length] ?? '').expect(201);
    }
    await login('017 1234 5678').expect(429);
    expect(normalizeLoginIdentifier(' Owner@Shop.TEST ')).toBe('owner@shop.test');
  });

  it('limits a single IP across many identifiers', async () => {
    for (let i = 0; i < perIp; i++) {
      await login(`user${String(i)}@shop.test`).expect(201);
    }
    await login('fresh@shop.test').expect(429);
  });

  it('never stores raw emails or phone numbers in rate-limit keys', async () => {
    await login('owner@shop.test').expect(201);
    const keys = [...store.counts.keys()].join(' ');
    expect(keys).toMatch(/^rl:login:ip:\S+ rl:login:id:[0-9a-f]{32}$/);
    expect(keys).not.toContain('owner@shop.test');
  });

  it('fails open when Redis is unavailable', async () => {
    store.failing = true;
    await login('01712345678').expect(201);
  });
});

import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  assertConnectedToTestDatabase,
  resolveIntegrationTestTargets,
} from '@dokanflow/db/testing';
import { type AuthResponse, authResponseSchema } from '@dokanflow/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/infra/prisma.service.js';
import { ApiExpressAdapter } from '../src/common/api-express.adapter.js';
import { type ApiEnv, parseApiEnv } from '../src/config/env.js';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export interface TestApp {
  app: INestApplication;
  server: Server;
  env: ApiEnv;
}

/**
 * Throws before anything connects if the TEST_* settings could reach development
 * data. The app below never sees DATABASE_URL or REDIS_URL from the environment.
 */
const targets = resolveIntegrationTestTargets(process.env);

/**
 * Boots the real application (same module, adapter and setup as main.ts) against
 * the test database. Rate limits are scaled up and namespaced per app instance, so
 * flow tests sharing 127.0.0.1 do not trip them; the rate-limit tests pass
 * `{ RATE_LIMIT_SCALE: '1' }` to exercise the real limits.
 */
export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const env = parseApiEnv({
    JWT_ACCESS_SECRET: 'Pq8Wn3Zx6Lt1Rb9Kv4Hy7Dm2Sf5Gc0Ju3Ne8Ta6Xo1Ql4Vi',
    API_CORS_ORIGINS: 'http://localhost:3000',
    RATE_LIMIT_SCALE: '1000',
    ...process.env,
    RATE_LIMIT_KEY_PREFIX: `rl-test-${randomUUID().slice(0, 8)}`,
    ...overrides,
    DATABASE_URL: targets.databaseUrl,
    REDIS_URL: targets.redisUrl,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] }).compile();
  const app = moduleRef.createNestApplication(new ApiExpressAdapter(), { bufferLogs: true });
  configureApp(app, env);
  await app.init();
  // Confirm with the server itself before any test sends a request.
  await assertConnectedToTestDatabase(app.get(PrismaService).client);
  return { app, server: app.getHttpServer() as Server, env };
}

export const CSRF = { 'x-dokanflow-csrf': '1' } as const;

/** Unique per call, so tests can run repeatedly against the same database. */
export function uniqueEmail(label: string): string {
  return `${label}-${randomUUID().slice(0, 8)}@test.dokanflow.local`;
}

/** A random valid Bangladeshi mobile number, in local format. */
export function uniquePhone(): string {
  return `017${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
}

/** The refresh token from a response's Set-Cookie header ("" if cleared). */
export function refreshCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown;
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const cookie = cookies.find((c) => /^(__Secure-)?dokanflow_rt=/.test(c));
  return cookie?.split(';')[0];
}

export interface Session {
  accessToken: string;
  /** "dokanflow_rt=<token>", ready for a Cookie header. */
  cookie: string;
  body: AuthResponse;
}

export function toSession(res: request.Response): Session {
  const cookie = refreshCookie(res);
  if (!cookie) throw new Error(`expected a refresh cookie, got status ${String(res.status)}`);
  const body = authResponseSchema.parse(res.body);
  return { accessToken: body.accessToken, cookie, body };
}

export async function registerOwner(
  server: Server,
  label: string,
): Promise<Session & { email: string; password: string }> {
  const email = uniqueEmail(label);
  const password = `pw-${randomUUID()}`;
  const res = await request(server)
    .post('/api/auth/register')
    .set(CSRF)
    .send({ businessName: `${label} Store`, name: `${label} Owner`, email, password })
    .expect(201);
  return { ...toSession(res), email, password };
}

export async function login(
  server: Server,
  identifier: string,
  password: string,
): Promise<Session> {
  const res = await request(server)
    .post('/api/auth/login')
    .set(CSRF)
    .send({ identifier, password })
    .expect(200);
  return toSession(res);
}

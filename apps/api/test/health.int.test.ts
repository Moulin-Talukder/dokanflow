import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { apiErrorSchema, readinessResponseSchema } from '@dokanflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { parseApiEnv } from '../src/config/env.js';

const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

describe('API (integration)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const env = parseApiEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, env);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live returns ok', async () => {
    const res = await request(server).get('/api/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /api/health reports Postgres and Redis as up', async () => {
    const res = await request(server).get('/api/health').expect(200);
    const body = readinessResponseSchema.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.redis.status).toBe('up');
  });

  it('generates a request id, or propagates a safe incoming one', async () => {
    const generated = await request(server).get('/api/health/live');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const propagated = await request(server)
      .get('/api/health/live')
      .set('x-request-id', 'trace-abc-123');
    expect(propagated.headers['x-request-id']).toBe('trace-abc-123');
  });

  it('renders unknown routes in the shared error shape', async () => {
    const res = await request(server)
      .get('/api/does-not-exist')
      .set('x-request-id', 'trace-404')
      .expect(404);
    const body = apiErrorSchema.parse(res.body);
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', requestId: 'trace-404' });
  });

  it('renders malformed JSON bodies in the shared error shape', async () => {
    const res = await request(server)
      .post('/api/health')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(apiErrorSchema.parse(res.body).error.message).toBe('Malformed JSON body');
  });

  it('sets security headers', async () => {
    const res = await request(server).get('/api/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves the OpenAPI document with the health endpoints', async () => {
    const res = await request(server).get('/api/docs-json').expect(200);
    const doc = res.body as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/api/health', '/api/health/live']),
    );
  });
});

import type { Server } from 'node:http';
import { Body, Controller, Get, type INestApplication, Param, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { apiErrorSchema } from '@dokanflow/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { ApiExpressAdapter } from './api-express.adapter.js';

@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: unknown): unknown {
    return body;
  }

  @Get(':id')
  find(@Param('id') id: string): { id: string } {
    return { id };
  }
}

// Real Express body parsing + ApiExpressAdapter + ApiExceptionFilter, without Postgres/Redis.
// The malformed-JSON case reproduces the CI failure fixed by ApiExpressAdapter.
describe('request body parsing errors (HTTP)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EchoController],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication(new ApiExpressAdapter(), { logger: false });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('renders malformed JSON as a 400 with a generic message', async () => {
    const res = await request(server)
      .post('/echo')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(apiErrorSchema.parse(res.body).error).toEqual({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Malformed JSON body',
    });
  });

  it('still parses valid JSON bodies', async () => {
    const res = await request(server).post('/echo').send({ name: 'Rice' }).expect(201);
    expect(res.body).toEqual({ name: 'Rice' });
  });

  it('renders an oversized body as 413 with a generic message', async () => {
    const res = await request(server)
      .post('/echo')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(200 * 1024) }))
      .expect(413);
    expect(apiErrorSchema.parse(res.body).error).toMatchObject({
      statusCode: 413,
      message: 'Request body too large',
    });
  });

  it("keeps Nest's default mapping for other framework errors (bad URL encoding)", async () => {
    const res = await request(server).get('/echo/%FF').expect(400);
    expect(apiErrorSchema.parse(res.body).error).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
    });
  });
});

import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { apiErrorSchema } from '@dokanflow/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RequestValidationException } from './request-validation.exception.js';
import { toApiError } from './to-api-error.js';

describe('toApiError', () => {
  it('maps validation failures with field paths', () => {
    const parsed = z
      .object({ items: z.array(z.object({ quantity: z.number().int().positive() })) })
      .safeParse({ items: [{ quantity: 0 }] });
    if (parsed.success) throw new Error('expected validation to fail');

    const { status, body } = toApiError(
      RequestValidationException.fromZodError(parsed.error),
      'r1',
    );

    expect(status).toBe(400);
    expect(body.error).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      requestId: 'r1',
      issues: [{ path: 'items.0.quantity' }],
    });
    expect(apiErrorSchema.safeParse(body).success).toBe(true);
  });

  it('maps HttpExceptions to stable codes and keeps 4xx messages', () => {
    expect(toApiError(new NotFoundException('Product not found')).body.error).toEqual({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Product not found',
    });
    expect(toApiError(new ForbiddenException()).body.error.code).toBe('FORBIDDEN');
  });

  it('hides messages of 5xx HttpExceptions', () => {
    const { status, body } = toApiError(
      new ServiceUnavailableException('db at 10.0.0.5 refused connection'),
    );
    expect(status).toBe(503);
    expect(body.error.message).toBe('Service unavailable');
  });

  it('turns unknown errors into a generic 500 without leaking details', () => {
    const { status, body } = toApiError(new Error('password=hunter2 in connection string'));
    expect(status).toBe(500);
    expect(body.error).toEqual({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('maps body-parser errors such as malformed JSON to 400', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    const { status, body } = toApiError(parseError);
    expect(status).toBe(400);
    expect(body.error.message).toBe('Malformed JSON body');
  });

  it('treats non-error throwables as internal errors', () => {
    expect(toApiError('boom').status).toBe(500);
    expect(toApiError(null).status).toBe(500);
  });
});

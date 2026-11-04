import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiExpressAdapter } from './api-express.adapter.js';
import { mapBodyParserError } from './body-parser-error.js';

/** Shaped like body-parser's errors: the original error plus http-errors fields. */
function bodyParserError(status: number, type: string, message: string): SyntaxError {
  return Object.assign(new SyntaxError(message), {
    status,
    statusCode: status,
    type,
    expose: true,
  });
}

describe('mapBodyParserError', () => {
  it('maps malformed JSON to 400 with a generic message and keeps the cause', () => {
    const original = bodyParserError(400, 'entity.parse.failed', 'Unexpected end of JSON input');
    const mapped = mapBodyParserError(original);

    expect(mapped).toBeInstanceOf(HttpException);
    expect(mapped?.getStatus()).toBe(400);
    expect(mapped?.message).toBe('Malformed JSON body');
    expect(mapped?.cause).toBe(original);
  });

  it('maps an oversized body to 413', () => {
    const mapped = mapBodyParserError(bodyParserError(413, 'entity.too.large', 'too large'));
    expect(mapped?.getStatus()).toBe(413);
    expect(mapped?.message).toBe('Request body too large');
  });

  it('uses a generic message for other body-parser errors', () => {
    const mapped = mapBodyParserError(bodyParserError(415, 'charset.unsupported', 'x'));
    expect(mapped?.getStatus()).toBe(415);
    expect(mapped?.message).toBe('Invalid request body');
  });

  it.each([
    ['a plain SyntaxError', new SyntaxError('Unexpected token')],
    ['an HttpException', new BadRequestException('nope')],
    ['a 5xx body-parser error', bodyParserError(500, 'stream.not.readable', 'x')],
    ['a non-object', 'boom'],
    ['null', null],
  ])('ignores %s', (_label, error) => {
    expect(mapBodyParserError(error)).toBeUndefined();
  });
});

describe('ApiExpressAdapter.mapException', () => {
  const adapter = new ApiExpressAdapter();

  it('maps body-parser errors before Nest does', () => {
    const mapped = adapter.mapException(
      bodyParserError(400, 'entity.parse.failed', 'Unexpected end of JSON input'),
    );
    expect(mapped).toBeInstanceOf(HttpException);
    expect((mapped as HttpException).message).toBe('Malformed JSON body');
  });

  it("falls back to Nest's mapping for other framework errors", () => {
    const mapped = adapter.mapException(new URIError('URI malformed'));
    expect(mapped).toBeInstanceOf(BadRequestException);
  });

  it('passes unrelated errors through unchanged', () => {
    const error = new Error('db down');
    expect(adapter.mapException(error)).toBe(error);
  });
});

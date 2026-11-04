import { HttpException } from '@nestjs/common';

/**
 * Errors raised by Express's body-parser: http-errors with a 4xx `status` and a
 * string `type` such as "entity.parse.failed" or "entity.too.large".
 */
interface BodyParserError {
  status: number;
  type: string;
}

function isBodyParserError(error: unknown): error is BodyParserError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { status, type } = error as { status?: unknown; type?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && typeof type === 'string';
}

function messageFor(type: string): string {
  switch (type) {
    case 'entity.parse.failed':
      return 'Malformed JSON body';
    case 'entity.too.large':
      return 'Request body too large';
    default:
      return 'Invalid request body';
  }
}

/**
 * Turns a body-parser error into an HttpException with a stable, generic message
 * (parser internals like "Unexpected token } in JSON at position 9" are not part of
 * the API contract). Returns undefined for anything else.
 */
export function mapBodyParserError(error: unknown): HttpException | undefined {
  if (!isBodyParserError(error)) {
    return undefined;
  }
  return new HttpException(messageFor(error.type), error.status, { cause: error });
}

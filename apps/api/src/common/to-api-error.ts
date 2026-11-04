import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@dokanflow/shared';
import { mapBodyParserError } from './body-parser-error.js';
import { RequestValidationException } from './request-validation.exception.js';

const codeByStatus: Partial<Record<number, ApiErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

function codeFor(status: number): ApiErrorCode {
  return codeByStatus[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
}

function messageFromHttpException(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  const message: unknown = (response as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message) && message.every((m): m is string => typeof m === 'string')) {
    return message.join('; ');
  }
  return exception.message;
}

export interface ApiErrorResult {
  status: number;
  body: ApiError;
}

/**
 * Maps any thrown value to the single API error shape.
 * Unknown errors become a generic 500 so internal details never reach clients.
 */
export function toApiError(error: unknown, requestId?: string): ApiErrorResult {
  // ApiExpressAdapter normally maps body-parser errors before filters run; mapping
  // here as well keeps the output correct for any path that delivers them raw.
  const exception = mapBodyParserError(error) ?? error;
  let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
  let code: ApiErrorCode = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let issues: ApiError['error']['issues'];

  if (exception instanceof RequestValidationException) {
    status = exception.getStatus();
    code = 'VALIDATION_FAILED';
    message = exception.message;
    issues = [...exception.issues];
  } else if (exception instanceof HttpException) {
    status = exception.getStatus();
    code = codeFor(status);
    // Messages of 5xx HttpExceptions can carry internals; keep them server-side.
    message = status >= 500 ? message : messageFromHttpException(exception);
    if (status === 503) {
      message = 'Service unavailable';
    }
  }

  return {
    status,
    body: {
      error: {
        statusCode: status,
        code,
        message,
        ...(issues ? { issues } : {}),
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}

import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@dokanflow/shared';
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

/** Errors thrown by Express body parsing (e.g. malformed JSON, body too large). */
function isBodyParserError(error: unknown): error is { status: number; type: string } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { status, type } = error as { status?: unknown; type?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && typeof type === 'string';
}

export interface ApiErrorResult {
  status: number;
  body: ApiError;
}

/**
 * Maps any thrown value to the single API error shape.
 * Unknown errors become a generic 500 so internal details never reach clients.
 */
export function toApiError(exception: unknown, requestId?: string): ApiErrorResult {
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
  } else if (isBodyParserError(exception)) {
    status = exception.status;
    code = codeFor(status);
    message =
      exception.type === 'entity.parse.failed' ? 'Malformed JSON body' : 'Invalid request body';
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

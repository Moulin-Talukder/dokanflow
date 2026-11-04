import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { toApiError } from './to-api-error.js';

/** Renders every error as the shared ApiError JSON shape, tagged with the request id. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const { status, body } = toApiError(exception, requestId);
    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId },
        `Unhandled error on ${request.method} ${request.url}`,
      );
    }
    response.status(status).json(body);
  }
}

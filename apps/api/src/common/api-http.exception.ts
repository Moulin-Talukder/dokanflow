import { HttpException } from '@nestjs/common';
import type { ApiErrorCode, ValidationIssue } from '@dokanflow/shared';

/**
 * An HttpException with an explicit API error code (otherwise derived from the
 * status), and optionally the fields it concerns (e.g. which cart line is short).
 */
export class ApiHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly issues?: readonly ValidationIssue[],
  ) {
    super(message, status);
  }
}

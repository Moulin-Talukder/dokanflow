import { HttpException } from '@nestjs/common';
import type { ApiErrorCode } from '@dokanflow/shared';

/** An HttpException with an explicit API error code (otherwise derived from the status). */
export class ApiHttpException extends HttpException {
  constructor(
    status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message, status);
  }
}

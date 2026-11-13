import { BadRequestException } from '@nestjs/common';
import { validationMessageEn, type ValidationIssue } from '@dokanflow/shared';
import type { z } from 'zod';

/** Thrown when request input fails Zod validation. Rendered as VALIDATION_FAILED. */
export class RequestValidationException extends BadRequestException {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super('Request validation failed');
  }

  static fromZodError(error: z.ZodError): RequestValidationException {
    return new RequestValidationException(
      error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        // Shared schemas use translatable keys; the API responds in English.
        message: validationMessageEn(issue.message),
      })),
    );
  }
}

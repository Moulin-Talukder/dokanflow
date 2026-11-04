import { type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { RequestValidationException } from './request-validation.exception.js';

/**
 * Validates and parses a request value (body, query or param) with a Zod schema,
 * usually one shared from @dokanflow/shared.
 *
 * Usage: `@Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductInput`
 */
export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw RequestValidationException.fromZodError(result.error);
    }
    return result.data;
  }
}

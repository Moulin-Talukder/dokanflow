import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Converts a shared Zod schema into an OpenAPI schema object for Swagger decorators,
 * so request/response docs come from the same schemas that validate at runtime.
 */
export function toOpenApiSchema(
  schema: z.ZodType,
  io: 'input' | 'output' = 'output',
): SchemaObject {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
  });
  // Zod emits a structurally compatible OpenAPI 3.0 schema. The two type
  // definitions come from different libraries, so bridge them at this one boundary.
  return jsonSchema as SchemaObject;
}

import { ExpressAdapter } from '@nestjs/platform-express';
import { mapBodyParserError } from './body-parser-error.js';

/**
 * Express adapter with DokanFlow's error mapping.
 *
 * Nest's ExpressAdapter.mapException converts body-parser SyntaxErrors into
 * `new BadRequestException(error.message)` before exception filters run. That drops
 * the body-parser `type` and leaks the raw parser message ("Unexpected end of JSON
 * input"). mapException is the documented hook for translating framework-native
 * errors, so body-parser errors are mapped here first; everything else keeps Nest's
 * default behaviour.
 */
export class ApiExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    return mapBodyParserError(error) ?? super.mapException(error);
  }
}

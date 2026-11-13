import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@dokanflow/shared';
import type { Request } from 'express';
import { ApiHttpException } from '../common/api-http.exception.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';

/**
 * CSRF defence for endpoints authenticated by the refresh-token cookie
 * (refresh, logout, switch-tenant). Two independent checks:
 *
 * 1. A custom header must be present. Cross-site forms cannot set headers, and a
 *    cross-origin fetch that sets one triggers a CORS preflight, which only the
 *    allowed web origins pass.
 * 2. If the browser sends an Origin header, it must be an allowed origin.
 *
 * Together with SameSite cookies this follows the OWASP CSRF cheat sheet
 * ("custom request headers" and "verifying origin with standard headers").
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: ApiEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE) {
      throw new ApiHttpException(403, 'FORBIDDEN', 'Missing CSRF header');
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !this.config.API_CORS_ORIGINS.includes(origin)) {
      throw new ApiHttpException(403, 'FORBIDDEN', 'Origin not allowed');
    }
    return true;
  }
}

import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiHttpException } from '../common/api-http.exception.js';
import { ALLOW_PASSWORD_CHANGE_REQUIRED } from './decorators.js';
import { isPublic } from './jwt-auth.guard.js';
import { MembershipLookup } from './membership.lookup.js';

/**
 * Step 2 of 3: resolves the user's membership in the token's tenant, and the
 * token's login session, from the database on every request. Role changes,
 * removals, disabled accounts, logout, password changes and resets therefore take
 * effect immediately rather than when the access token expires.
 * Also enforces the first-login password change.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipLookup,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const claims = req.accessClaims;
    if (!claims) {
      throw new UnauthorizedException();
    }

    // The token's tenant and session are server-signed, so they are safe RLS context.
    const found = await this.memberships.forAccessToken(claims);
    if (
      found?.userStatus !== 'active' ||
      found.tenantStatus !== 'active' ||
      // Logout, refresh-token reuse, password change or reset, or the session's
      // absolute expiry: the access token stops working immediately.
      !found.sessionActive
    ) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    req.auth = {
      userId: claims.sub,
      tenantId: claims.tid,
      role: found.role,
      sessionId: claims.sid,
      mustChangePassword: found.mustChangePassword,
    };

    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_PASSWORD_CHANGE_REQUIRED,
      [context.getHandler(), context.getClass()],
    );
    if (found.mustChangePassword && allowed !== true) {
      throw new ApiHttpException(
        403,
        'PASSWORD_CHANGE_REQUIRED',
        'Change your temporary password to continue',
      );
    }
    return true;
  }
}

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
 * Step 2 of 3: resolves the user's membership in the token's tenant from the
 * database on every request, so role changes, removals, disabled accounts and
 * password resets take effect immediately rather than when the token expires.
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

    const found = await this.memberships.find(claims.sub, claims.tid);
    if (
      found?.userStatus !== 'active' ||
      found.tenantStatus !== 'active' ||
      // Tokens issued before the last password change or reset are no longer valid.
      claims.iat < Math.floor(found.passwordChangedAt.getTime() / 1000)
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

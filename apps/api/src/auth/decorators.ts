import {
  createParamDecorator,
  type ExecutionContext,
  InternalServerErrorException,
  SetMetadata,
} from '@nestjs/common';
import type { Permission } from '@dokanflow/shared';
import type { Request } from 'express';
import type { AuthContext } from './auth-context.js';

export const IS_PUBLIC = 'auth:isPublic';
export const ALLOW_PASSWORD_CHANGE_REQUIRED = 'auth:allowPasswordChangeRequired';
export const REQUIRED_PERMISSIONS = 'auth:requiredPermissions';

/** No access token needed (login, register, health, cookie-based refresh). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Reachable while the user still has to replace a temporary password. */
export const AllowWhilePasswordChangeRequired = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_REQUIRED, true);

/** The current membership's role must grant every listed permission. */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/** The resolved AuthContext. Only valid on routes that are not @Public(). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const auth = ctx.switchToHttp().getRequest<Request>().auth;
    if (!auth) {
      // A programming error: the route is public or the guards did not run.
      throw new InternalServerErrorException('Auth context missing');
    }
    return auth;
  },
);

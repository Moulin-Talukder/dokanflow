import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission, type Permission } from '@dokanflow/shared';
import type { Request } from 'express';
import { REQUIRED_PERMISSIONS } from './decorators.js';
import { isPublic } from './jwt-auth.guard.js';

/** Step 3 of 3: checks @RequirePermission against the role-permission map in @dokanflow/shared. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublic(this.reflector, context)) {
      return true;
    }
    const required =
      this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRED_PERMISSIONS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    const auth = context.switchToHttp().getRequest<Request>().auth;
    if (!auth) {
      throw new ForbiddenException();
    }
    if (!required.every((permission) => hasPermission(auth.role, permission))) {
      throw new ForbiddenException('Your role does not allow this action');
    }
    return true;
  }
}

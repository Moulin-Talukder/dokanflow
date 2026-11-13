import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessTokenService, InvalidAccessTokenError } from './access-token.service.js';
import { IS_PUBLIC } from './decorators.js';

/** Step 1 of 3: verifies the bearer access token. Registered globally. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, context)) {
      return true;
    }
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    const match = header ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
    if (!match?.[1]) {
      throw new UnauthorizedException('Missing bearer token');
    }
    try {
      req.accessClaims = await this.tokens.verify(match[1]);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      throw error;
    }
    return true;
  }
}

export function isPublic(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}

import { createHash } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { readRefreshCookie, refreshCookieConfig } from '../auth/refresh-cookie.js';
import { ApiHttpException } from '../common/api-http.exception.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { RATE_LIMIT_POLICIES, type RateLimitPolicyName } from './rate-limit.policies.js';
import type { RateLimitStore } from './rate-limit.store.js';

export const RATE_LIMIT_POLICY = 'rateLimit:policy';
export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/** Applies a named policy from RATE_LIMIT_POLICIES. Use with @UseGuards(RateLimitGuard). */
export const RateLimit = (policy: RateLimitPolicyName): MethodDecorator =>
  SetMetadata(RATE_LIMIT_POLICY, policy);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

/**
 * Counts the request against the client IP and the request's identifier, and
 * answers 429 with Retry-After when either is over its limit. If Redis is
 * unavailable the request is allowed (and logged): an outage must not lock every
 * user out. The Argon2 concurrency cap still bounds the cost of password requests.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private lastFailureLoggedAt = 0;
  private readonly cookieName: string;

  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    @Inject(APP_CONFIG) private readonly config: ApiEnv,
  ) {
    this.cookieName = refreshCookieConfig(config).name;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const name = this.reflector.get<RateLimitPolicyName | undefined>(
      RATE_LIMIT_POLICY,
      context.getHandler(),
    );
    if (!name) {
      return true;
    }
    const policy = RATE_LIMIT_POLICIES[name];
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    const scale = this.config.RATE_LIMIT_SCALE;
    const prefix = `${this.config.RATE_LIMIT_KEY_PREFIX}:${name}`;
    const windowMs = policy.windowSeconds * 1000;
    const cookie = readRefreshCookie(req, this.cookieName);
    const identifier = policy.identifier(req, cookie.status === 'ok' ? cookie.token : undefined);

    const checks: { key: string; limit: number }[] = [
      { key: `${prefix}:ip:${req.ip ?? 'unknown'}`, limit: policy.perIp * scale },
    ];
    if (identifier !== null) {
      checks.push({
        key: `${prefix}:id:${digest(identifier)}`,
        limit: policy.perIdentifier * scale,
      });
    }

    let hits;
    try {
      hits = await Promise.all(checks.map((check) => this.store.hit(check.key, windowMs)));
    } catch (error) {
      this.logFailure(error);
      return true;
    }

    const exceeded = hits.filter((hit, i) => hit.count > (checks[i]?.limit ?? Infinity));
    if (exceeded.length > 0) {
      const retryAfter = Math.max(1, ...exceeded.map((hit) => Math.ceil(hit.ttlMs / 1000)));
      res.setHeader('Retry-After', String(retryAfter));
      throw new ApiHttpException(429, 'TOO_MANY_REQUESTS', 'Too many attempts, try again later');
    }
    return true;
  }

  private logFailure(error: unknown): void {
    const now = Date.now();
    if (now - this.lastFailureLoggedAt > 30_000) {
      this.lastFailureLoggedAt = now;
      this.logger.warn({ err: error }, 'Rate limiting unavailable (Redis error); allowing request');
    }
  }
}

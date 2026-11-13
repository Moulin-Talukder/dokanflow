import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';

const ISSUER = 'dokanflow-api';
const AUDIENCE = 'dokanflow';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AccessTokenClaims {
  /** User id. */
  sub: string;
  /** Active tenant id. */
  tid: string;
  /** Session id: the refresh-token family this access token belongs to. */
  sid: string;
  /** Issued-at, in seconds since the epoch. */
  iat: number;
}

export class InvalidAccessTokenError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'InvalidAccessTokenError';
  }
}

/** Short-lived HS256 JWTs. Only the API issues and verifies them. */
@Injectable()
export class AccessTokenService {
  private readonly key: Uint8Array;
  readonly ttlSeconds: number;

  constructor(@Inject(APP_CONFIG) config: ApiEnv) {
    this.key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);
    this.ttlSeconds = config.JWT_ACCESS_TTL_SECONDS;
  }

  async sign(claims: { userId: string; tenantId: string; sessionId: string }): Promise<string> {
    return new SignJWT({ tid: claims.tenantId, sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${String(this.ttlSeconds)}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        requiredClaims: ['sub', 'iat', 'exp'],
      });
      const { sub, tid, sid, iat } = payload;
      if (
        typeof sub !== 'string' ||
        !UUID.test(sub) ||
        typeof tid !== 'string' ||
        !UUID.test(tid) ||
        typeof sid !== 'string' ||
        !UUID.test(sid) ||
        typeof iat !== 'number'
      ) {
        throw new InvalidAccessTokenError('malformed claims');
      }
      return { sub, tid, sid, iat };
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) throw error;
      if (error instanceof errors.JWTExpired) throw new InvalidAccessTokenError('expired');
      throw new InvalidAccessTokenError('invalid');
    }
  }
}

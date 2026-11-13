import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CsrfGuard } from './csrf.guard.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { MembershipLookup } from './membership.lookup.js';
import { PasswordHasher } from './password-hasher.service.js';
import { PermissionsGuard } from './permissions.guard.js';
import { PrismaRefreshTokenStore } from './prisma-refresh-token.store.js';
import { RefreshTokenService } from './refresh-token.js';
import { TenantContextGuard } from './tenant-context.guard.js';

const DAY_MS = 24 * 60 * 60 * 1000;

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AccessTokenService,
    MembershipLookup,
    PrismaRefreshTokenStore,
    {
      provide: RefreshTokenService,
      inject: [PrismaRefreshTokenStore, APP_CONFIG],
      useFactory: (store: PrismaRefreshTokenStore, config: ApiEnv) =>
        new RefreshTokenService(store, {
          refreshTtlMs: config.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
          sessionMaxAgeMs: config.SESSION_MAX_AGE_DAYS * DAY_MS,
        }),
    },
    PasswordHasher,
    AuthService,
    CsrfGuard,
    // Global guards run in this order on every route not marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AccessTokenService, MembershipLookup, RefreshTokenService, AuthService, PasswordHasher],
})
export class AuthModule {}

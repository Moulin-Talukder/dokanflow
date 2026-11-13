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
import { PermissionsGuard } from './permissions.guard.js';
import { PrismaRefreshTokenStore } from './prisma-refresh-token.store.js';
import { RefreshTokenService } from './refresh-token.js';
import { TenantContextGuard } from './tenant-context.guard.js';

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
        new RefreshTokenService(store, config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
    AuthService,
    CsrfGuard,
    // Global guards run in this order on every route not marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AccessTokenService, MembershipLookup, RefreshTokenService, AuthService],
})
export class AuthModule {}

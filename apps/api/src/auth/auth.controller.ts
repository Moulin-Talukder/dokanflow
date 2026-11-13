import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthResponse,
  authResponseSchema,
  type ChangePasswordRequest,
  changePasswordRequestSchema,
  CSRF_HEADER,
  type LoginRequest,
  loginRequestSchema,
  type RegisterRequest,
  registerRequestSchema,
  type Session,
  sessionSchema,
  type SwitchTenantRequest,
  switchTenantRequestSchema,
} from '@dokanflow/shared';
import type { Request, Response } from 'express';
import { toOpenApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import type { AuthContext } from './auth-context.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { clientMeta } from './client-meta.js';
import { CsrfGuard } from './csrf.guard.js';
import { AllowWhilePasswordChangeRequired, CurrentAuth, Public } from './decorators.js';
import { readCookie, type RefreshCookieConfig, refreshCookieConfig } from './refresh-cookie.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookie: RefreshCookieConfig;

  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) config: ApiEnv,
  ) {
    this.cookie = refreshCookieConfig(config);
  }

  @Public()
  @Post('register')
  @ApiBody({ schema: toOpenApiSchema(registerRequestSchema, 'input') })
  @ApiOkResponse({ schema: toOpenApiSchema(authResponseSchema) })
  async register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.send(res, await this.auth.register(body, clientMeta(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiBody({ schema: toOpenApiSchema(loginRequestSchema, 'input') })
  @ApiOkResponse({ schema: toOpenApiSchema(authResponseSchema) })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.send(res, await this.auth.login(body, clientMeta(req)));
  }

  /** Cookie-authenticated, so CSRF-protected. Rotates the refresh token. */
  @Public()
  @UseGuards(CsrfGuard)
  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth()
  @ApiOkResponse({ schema: toOpenApiSchema(authResponseSchema) })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      return this.send(res, await this.auth.refresh(this.readToken(req), clientMeta(req)));
    } catch (error) {
      this.clear(res);
      throw error;
    }
  }

  @Public()
  @UseGuards(CsrfGuard)
  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth()
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.readToken(req));
    this.clear(res);
  }

  @Get('me')
  @AllowWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @ApiOkResponse({ schema: toOpenApiSchema(sessionSchema) })
  me(@CurrentAuth() auth: AuthContext): Promise<Session> {
    return this.auth.session(auth.userId, auth.tenantId);
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowWhilePasswordChangeRequired()
  @ApiBearerAuth()
  @ApiBody({ schema: toOpenApiSchema(changePasswordRequestSchema, 'input') })
  @ApiOkResponse({ schema: toOpenApiSchema(authResponseSchema) })
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.send(res, await this.auth.changePassword(auth, body, clientMeta(req)));
  }

  /** Uses both the access token and the refresh cookie, so CSRF-protected too. */
  @UseGuards(CsrfGuard)
  @Post('switch-tenant')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiCookieAuth()
  @ApiBody({ schema: toOpenApiSchema(switchTenantRequestSchema, 'input') })
  @ApiOkResponse({ schema: toOpenApiSchema(authResponseSchema) })
  async switchTenant(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(switchTenantRequestSchema)) body: SwitchTenantRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.send(
      res,
      await this.auth.switchTenant(auth, this.readToken(req), body.tenantId, clientMeta(req)),
    );
  }

  private readToken(req: Request): string | undefined {
    return readCookie(req, this.cookie.name);
  }

  private send(res: Response, issued: IssuedSession): AuthResponse {
    res.cookie(this.cookie.name, issued.refreshToken, this.cookie.options);
    res.setHeader('Cache-Control', 'no-store');
    return issued.body;
  }

  private clear(res: Response): void {
    const { maxAge: _maxAge, ...options } = this.cookie.options;
    res.clearCookie(this.cookie.name, options);
  }
}

/** Documented for Swagger users: cookie endpoints need this header. */
export const CSRF_HEADER_DOC = CSRF_HEADER;

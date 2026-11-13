import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateStaffRequest,
  createStaffRequestSchema,
  type ResetStaffPasswordRequest,
  resetStaffPasswordRequestSchema,
  type StaffListResponse,
  staffListResponseSchema,
  type StaffMember,
  staffMemberSchema,
} from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { toOpenApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RateLimit, RateLimitGuard } from '../rate-limit/rate-limit.guard.js';
import { StaffService } from './staff.service.js';

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermission('staff:read')
  @ApiOkResponse({ schema: toOpenApiSchema(staffListResponseSchema) })
  async list(@CurrentAuth() auth: AuthContext): Promise<StaffListResponse> {
    return { items: await this.staff.list(auth) };
  }

  @Post()
  @RequirePermission('staff:create')
  @ApiBody({ schema: toOpenApiSchema(createStaffRequestSchema, 'input') })
  @ApiCreatedResponse({ schema: toOpenApiSchema(staffMemberSchema) })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createStaffRequestSchema)) body: CreateStaffRequest,
  ): Promise<StaffMember> {
    return this.staff.create(auth, body);
  }

  @Post(':userId/reset-password')
  @HttpCode(204)
  @RequirePermission('staff:reset-password')
  @UseGuards(RateLimitGuard)
  @RateLimit('staffResetPassword')
  @ApiBody({ schema: toOpenApiSchema(resetStaffPasswordRequestSchema, 'input') })
  async resetPassword(
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(resetStaffPasswordRequestSchema)) body: ResetStaffPasswordRequest,
  ): Promise<void> {
    await this.staff.resetPassword(auth, userId, body);
  }
}

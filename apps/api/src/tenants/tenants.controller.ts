import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import {
  type CreateTenantRequest,
  createTenantRequestSchema,
  type MembershipSummary,
  membershipSummarySchema,
} from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentAuth } from '../auth/decorators.js';
import { toOpenApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TenantsService } from './tenants.service.js';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Creates another business owned by the current user. Switch to it with /auth/switch-tenant. */
  @Post()
  @ApiBody({ schema: toOpenApiSchema(createTenantRequestSchema, 'input') })
  @ApiCreatedResponse({ schema: toOpenApiSchema(membershipSummarySchema) })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createTenantRequestSchema)) body: CreateTenantRequest,
  ): Promise<MembershipSummary> {
    return this.tenants.create(auth, body);
  }
}

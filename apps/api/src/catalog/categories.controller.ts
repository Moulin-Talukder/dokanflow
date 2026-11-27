import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  type Category,
  type CategoryListResponse,
  categoryListResponseSchema,
  categorySchema,
  type CreateCategoryRequest,
  createCategoryRequestSchema,
} from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { toOpenApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CategoriesService } from './categories.service.js';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequirePermission('catalog:read')
  @ApiOkResponse({ schema: toOpenApiSchema(categoryListResponseSchema) })
  async list(@CurrentAuth() auth: AuthContext): Promise<CategoryListResponse> {
    return { items: await this.categories.list(auth) };
  }

  @Post()
  @RequirePermission('catalog:write')
  @ApiBody({ schema: toOpenApiSchema(createCategoryRequestSchema, 'input') })
  @ApiCreatedResponse({ schema: toOpenApiSchema(categorySchema) })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createCategoryRequestSchema)) body: CreateCategoryRequest,
  ): Promise<Category> {
    return this.categories.create(auth, body);
  }
}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateSaleRequest,
  createSaleRequestSchema,
  type Sale,
  type SaleListQuery,
  saleListQuerySchema,
  type SaleListResponse,
  saleListResponseSchema,
  saleSchema,
  type VoidSaleRequest,
  voidSaleRequestSchema,
} from '@dokanflow/shared';
import type { Response } from 'express';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { IdempotencyKey, markReplay } from '../common/idempotency.js';
import { toOpenApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SalesService } from './sales.service.js';

const saleId = new ParseUUIDPipe();

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /**
   * A fully paid cash sale. Requires an Idempotency-Key header: a retry with the
   * same key and body returns the original sale (200, Idempotent-Replayed: true);
   * the same key with a different body is refused (409 IDEMPOTENCY_KEY_REUSED).
   */
  @Post()
  @RequirePermission('sale:create')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ schema: toOpenApiSchema(createSaleRequestSchema, 'input') })
  @ApiCreatedResponse({ schema: toOpenApiSchema(saleSchema) })
  async create(
    @CurrentAuth() auth: AuthContext,
    @IdempotencyKey() key: string,
    @Body(new ZodValidationPipe(createSaleRequestSchema)) body: CreateSaleRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sale> {
    const { sale, replayed } = await this.sales.create(auth, key, body);
    markReplay(res, replayed);
    return sale;
  }

  /** Newest first. `from`/`to` are calendar days in Asia/Dhaka; `search` is an invoice number. */
  @Get()
  @RequirePermission('sale:read')
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['completed', 'voided'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ schema: toOpenApiSchema(saleListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(saleListQuerySchema)) query: SaleListQuery,
  ): Promise<SaleListResponse> {
    return this.sales.list(auth, query);
  }

  @Get(':id')
  @RequirePermission('sale:read')
  @ApiOkResponse({ schema: toOpenApiSchema(saleSchema) })
  get(@CurrentAuth() auth: AuthContext, @Param('id', saleId) id: string): Promise<Sale> {
    return this.sales.get(auth, id);
  }

  /** Owners and managers only. Restores stock once; the sale is kept, marked voided. */
  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission('sale:void')
  @ApiBody({ schema: toOpenApiSchema(voidSaleRequestSchema, 'input') })
  @ApiOkResponse({ schema: toOpenApiSchema(saleSchema) })
  void(
    @CurrentAuth() auth: AuthContext,
    @Param('id', saleId) id: string,
    @Body(new ZodValidationPipe(voidSaleRequestSchema)) body: VoidSaleRequest,
  ): Promise<Sale> {
    return this.sales.void(auth, id, body);
  }
}

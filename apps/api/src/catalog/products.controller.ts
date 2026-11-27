import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  type CreateProductRequest,
  createProductRequestSchema,
  type MovementListQuery,
  movementListQuerySchema,
  type Product,
  type ProductListQuery,
  productListQuerySchema,
  type ProductListResponse,
  productListResponseSchema,
  productSchema,
  type StockAdjustmentRequest,
  stockAdjustmentRequestSchema,
  type StockChangeResponse,
  stockChangeResponseSchema,
  type StockInRequest,
  stockInRequestSchema,
  type StockMovementListResponse,
  stockMovementListResponseSchema,
  type UpdateProductRequest,
  updateProductRequestSchema,
} from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { toOpenApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { StockService } from '../inventory/stock.service.js';
import { ProductsService } from './products.service.js';

const productId = new ParseUUIDPipe();

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly stock: StockService,
  ) {}

  /** Search (name/SKU substring, barcode exact), category and low-stock filters, pagination. */
  @Get()
  @RequirePermission('catalog:read')
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'lowStock', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'includeArchived', required: false, enum: ['true', 'false'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ schema: toOpenApiSchema(productListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery,
  ): Promise<ProductListResponse> {
    return this.products.list(auth, query);
  }

  @Post()
  @RequirePermission('catalog:write')
  @ApiBody({ schema: toOpenApiSchema(createProductRequestSchema, 'input') })
  @ApiCreatedResponse({ schema: toOpenApiSchema(productSchema) })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(createProductRequestSchema)) body: CreateProductRequest,
  ): Promise<Product> {
    return this.products.create(auth, body);
  }

  @Get(':id')
  @RequirePermission('catalog:read')
  @ApiOkResponse({ schema: toOpenApiSchema(productSchema) })
  get(@CurrentAuth() auth: AuthContext, @Param('id', productId) id: string): Promise<Product> {
    return this.products.get(auth, id);
  }

  /** Partial update; `archived` archives or restores. The unit is locked once stock has moved. */
  @Patch(':id')
  @RequirePermission('catalog:write')
  @ApiBody({ schema: toOpenApiSchema(updateProductRequestSchema, 'input') })
  @ApiOkResponse({ schema: toOpenApiSchema(productSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', productId) id: string,
    @Body(new ZodValidationPipe(updateProductRequestSchema)) body: UpdateProductRequest,
  ): Promise<Product> {
    return this.products.update(auth, id, body);
  }

  /** Stock received. Quantity in base units (pieces, grams, millilitres). */
  @Post(':id/stock/in')
  @RequirePermission('stock:write')
  @ApiBody({ schema: toOpenApiSchema(stockInRequestSchema, 'input') })
  @ApiCreatedResponse({ schema: toOpenApiSchema(stockChangeResponseSchema) })
  stockIn(
    @CurrentAuth() auth: AuthContext,
    @Param('id', productId) id: string,
    @Body(new ZodValidationPipe(stockInRequestSchema)) body: StockInRequest,
  ): Promise<StockChangeResponse> {
    return this.stock.stockIn(auth, id, body);
  }

  /** A signed correction with a required reason. Stock never goes below zero (409). */
  @Post(':id/stock/adjustments')
  @RequirePermission('stock:write')
  @ApiBody({ schema: toOpenApiSchema(stockAdjustmentRequestSchema, 'input') })
  @ApiCreatedResponse({ schema: toOpenApiSchema(stockChangeResponseSchema) })
  adjust(
    @CurrentAuth() auth: AuthContext,
    @Param('id', productId) id: string,
    @Body(new ZodValidationPipe(stockAdjustmentRequestSchema)) body: StockAdjustmentRequest,
  ): Promise<StockChangeResponse> {
    return this.stock.adjust(auth, id, body);
  }

  /** Movement history, newest first. */
  @Get(':id/stock/movements')
  @RequirePermission('stock:read')
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ schema: toOpenApiSchema(stockMovementListResponseSchema) })
  movements(
    @CurrentAuth() auth: AuthContext,
    @Param('id', productId) id: string,
    @Query(new ZodValidationPipe(movementListQuerySchema)) query: MovementListQuery,
  ): Promise<StockMovementListResponse> {
    return this.stock.movements(auth, id, query);
  }
}

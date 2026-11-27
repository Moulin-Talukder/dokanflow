import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type TransactionClient, withDbContext } from '@dokanflow/db';
import type {
  CreateProductRequest,
  Product,
  ProductListQuery,
  ProductListResponse,
  UpdateProductRequest,
} from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { ApiHttpException } from '../common/api-http.exception.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';
import { mapInventoryDbError } from '../inventory/db-errors.js';
import { defaultBranchId } from '../inventory/default-branch.js';
import { countProducts, selectProducts } from './product-query.js';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(auth: AuthContext, query: ProductListQuery): Promise<ProductListResponse> {
    return withDbContext(this.prisma.client, auth, async (tx) => {
      const branchId = await defaultBranchId(tx, auth.tenantId);
      const filter = {
        ...(query.search ? { search: query.search } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        lowStock: query.lowStock,
        includeArchived: query.includeArchived,
      };
      const [items, total] = await Promise.all([
        selectProducts(tx, auth.tenantId, branchId, filter, {
          limit: query.pageSize,
          offset: (query.page - 1) * query.pageSize,
        }),
        countProducts(tx, auth.tenantId, branchId, filter),
      ]);
      return { items, page: query.page, pageSize: query.pageSize, total };
    });
  }

  async get(auth: AuthContext, productId: string): Promise<Product> {
    return withDbContext(this.prisma.client, auth, (tx) => this.load(tx, auth, productId));
  }

  async create(auth: AuthContext, input: CreateProductRequest): Promise<Product> {
    try {
      return await withDbContext(this.prisma.client, auth, async (tx) => {
        await this.assertCategory(tx, input.categoryId);
        await this.assertIdentifiersFree(tx, auth, { sku: input.sku, barcode: input.barcode });
        const created = await tx.product.create({
          data: { tenantId: auth.tenantId, ...input },
          select: { id: true },
        });
        return this.load(tx, auth, created.id);
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  async update(
    auth: AuthContext,
    productId: string,
    input: UpdateProductRequest,
  ): Promise<Product> {
    try {
      return await withDbContext(this.prisma.client, auth, async (tx) => {
        const current = await tx.product.findUnique({
          where: { id: productId },
          select: { id: true, unit: true },
        });
        if (!current) {
          throw new NotFoundException('Product not found');
        }
        const { archived, ...fields } = input;
        if (fields.categoryId !== undefined) await this.assertCategory(tx, fields.categoryId);
        await this.assertIdentifiersFree(
          tx,
          auth,
          {
            ...(fields.sku !== undefined ? { sku: fields.sku } : {}),
            ...(fields.barcode !== undefined ? { barcode: fields.barcode } : {}),
          },
          productId,
        );
        if (fields.unit !== undefined && fields.unit !== current.unit) {
          const moved = await tx.stockMovement.count({ where: { productId }, take: 1 });
          if (moved > 0) {
            throw new ApiHttpException(
              409,
              'UNIT_LOCKED',
              'The unit cannot change after stock has moved',
            );
          }
        }
        await tx.product.update({
          where: { id: productId },
          data: {
            ...fields,
            ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
          },
        });
        return this.load(tx, auth, productId);
      });
    } catch (error) {
      throw this.mapWriteError(error);
    }
  }

  /** Loads one product as the API returns it. RLS makes other shops' products "not found". */
  async load(tx: TransactionClient, auth: AuthContext, productId: string): Promise<Product> {
    const branchId = await defaultBranchId(tx, auth.tenantId);
    const [product] = await selectProducts(
      tx,
      auth.tenantId,
      branchId,
      { productId, includeArchived: true },
      { limit: 1, offset: 0 },
    );
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async assertCategory(tx: TransactionClient, categoryId: string | null): Promise<void> {
    if (categoryId === null) return;
    const category = await tx.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  /** Clear 409s for the common case; the unique indexes still guard races. */
  private async assertIdentifiersFree(
    tx: TransactionClient,
    auth: AuthContext,
    ids: { sku?: string; barcode?: string | null },
    exceptProductId?: string,
  ): Promise<void> {
    const notSelf = exceptProductId ? { id: { not: exceptProductId } } : {};
    if (ids.sku !== undefined) {
      const taken = await tx.product.findFirst({
        where: { tenantId: auth.tenantId, sku: ids.sku, ...notSelf },
        select: { id: true },
      });
      if (taken) throw new ConflictException('A product with this SKU already exists');
    }
    if (ids.barcode !== undefined && ids.barcode !== null) {
      const taken = await tx.product.findFirst({
        where: { tenantId: auth.tenantId, barcode: ids.barcode, ...notSelf },
        select: { id: true },
      });
      if (taken) throw new ConflictException('A product with this barcode already exists');
    }
  }

  private mapWriteError(error: unknown): unknown {
    if (isUniqueViolation(error)) {
      return new ConflictException('SKU or barcode already in use');
    }
    try {
      mapInventoryDbError(error);
    } catch (mapped) {
      return mapped;
    }
    return error;
  }
}

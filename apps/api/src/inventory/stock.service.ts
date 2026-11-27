import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { type TransactionClient, withDbContext } from '@dokanflow/db';
import {
  applyStockDelta,
  isLowStock,
  type MovementListQuery,
  type StockAdjustmentRequest,
  type StockChangeResponse,
  type StockInRequest,
  type StockMovement,
  type StockMovementListResponse,
} from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { ApiHttpException } from '../common/api-http.exception.js';
import { PrismaService } from '../infra/prisma.service.js';
import { mapInventoryDbError } from './db-errors.js';
import { defaultBranchId } from './default-branch.js';

const movementSelect = {
  id: true,
  type: true,
  quantityDelta: true,
  quantityAfter: true,
  reason: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} as const;

function toMovement(row: {
  id: string;
  type: StockMovement['type'];
  quantityDelta: number;
  quantityAfter: number;
  reason: string | null;
  createdAt: Date;
  actor: { id: string; name: string };
}): StockMovement {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * Stock changes. Every change is one stock_movements row; the database trigger
 * applies it to stock_levels. Here the level is locked and checked first so the
 * caller gets a clear 409 instead of a trigger error.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  stockIn(
    auth: AuthContext,
    productId: string,
    input: StockInRequest,
  ): Promise<StockChangeResponse> {
    return this.record(auth, productId, {
      type: 'purchase',
      delta: input.quantity,
      reason: input.note ?? null,
    });
  }

  adjust(
    auth: AuthContext,
    productId: string,
    input: StockAdjustmentRequest,
  ): Promise<StockChangeResponse> {
    return this.record(auth, productId, {
      type: 'adjustment',
      delta: input.delta,
      reason: input.reason,
    });
  }

  async movements(
    auth: AuthContext,
    productId: string,
    query: MovementListQuery,
  ): Promise<StockMovementListResponse> {
    return withDbContext(this.prisma.client, auth, async (tx) => {
      await this.findProduct(tx, productId);
      const where = { tenantId: auth.tenantId, productId };
      const [rows, total] = await Promise.all([
        tx.stockMovement.findMany({
          where,
          select: movementSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.pageSize,
          skip: (query.page - 1) * query.pageSize,
        }),
        tx.stockMovement.count({ where }),
      ]);
      return { items: rows.map(toMovement), page: query.page, pageSize: query.pageSize, total };
    });
  }

  private async record(
    auth: AuthContext,
    productId: string,
    change: { type: 'purchase' | 'adjustment'; delta: number; reason: string | null },
  ): Promise<StockChangeResponse> {
    try {
      return await withDbContext(this.prisma.client, auth, async (tx) => {
        const product = await this.findProduct(tx, productId);
        if (product.archivedAt !== null) {
          throw new ConflictException('Restore the product before changing its stock');
        }
        const branchId = await defaultBranchId(tx, auth.tenantId);

        // Serialize stock changes per product by locking the product row (app_user
        // cannot lock stock_levels: it has no UPDATE privilege there, by design). NO KEY
        // UPDATE does not block the key-share locks foreign-key checks take. The
        // trigger also locks the level row and remains the authority.
        await tx.$queryRaw`
          SELECT id FROM products
          WHERE tenant_id = ${auth.tenantId}::uuid AND id = ${productId}::uuid
          FOR NO KEY UPDATE`;
        const [level] = await tx.$queryRaw<{ quantity: number }[]>`
          SELECT quantity FROM stock_levels
          WHERE tenant_id = ${auth.tenantId}::uuid AND branch_id = ${branchId}::uuid
            AND product_id = ${productId}::uuid`;
        const check = applyStockDelta(level?.quantity ?? 0, change.delta);
        if (!check.ok) {
          throw new ApiHttpException(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this change');
        }

        const movement = await tx.stockMovement.create({
          data: {
            tenantId: auth.tenantId,
            branchId,
            productId,
            type: change.type,
            quantityDelta: change.delta,
            reason: change.reason,
            actorUserId: auth.userId,
          },
          select: movementSelect,
        });
        return {
          stockQuantity: movement.quantityAfter,
          isLowStock: isLowStock(movement.quantityAfter, product.lowStockThreshold),
          movement: toMovement(movement),
        };
      });
    } catch (error) {
      if (
        error instanceof ApiHttpException ||
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      mapInventoryDbError(error);
    }
  }

  private async findProduct(tx: TransactionClient, productId: string) {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, archivedAt: true, lowStockThreshold: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }
}

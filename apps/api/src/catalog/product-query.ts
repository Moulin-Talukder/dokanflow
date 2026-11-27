import { Prisma, type TransactionClient } from '@dokanflow/db';
import { isLowStock, type Product, type ProductUnit } from '@dokanflow/shared';

interface ProductRow {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  unit: ProductUnit;
  price_poisha: number;
  cost_poisha: number;
  vat_rate_bp: number | null;
  low_stock_threshold: number | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
  category_id: string | null;
  category_name: string | null;
  stock_quantity: number;
  unit_locked: boolean;
}

/** Escapes LIKE wildcards so a search for "50%" or "a_b" matches literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface ProductFilter {
  productId?: string;
  search?: string;
  categoryId?: string;
  lowStock?: boolean;
  includeArchived?: boolean;
}

function whereClause(tenantId: string, branchId: string, filter: ProductFilter): Prisma.Sql {
  // RLS already limits rows to the tenant; the explicit filter is defence in depth.
  const conditions: Prisma.Sql[] = [Prisma.sql`p.tenant_id = ${tenantId}::uuid`];
  if (filter.productId) conditions.push(Prisma.sql`p.id = ${filter.productId}::uuid`);
  if (!filter.includeArchived) conditions.push(Prisma.sql`p.archived_at IS NULL`);
  if (filter.categoryId) conditions.push(Prisma.sql`p.category_id = ${filter.categoryId}::uuid`);
  if (filter.search) {
    const pattern = `%${escapeLike(filter.search)}%`;
    conditions.push(
      Prisma.sql`(p.name ILIKE ${pattern} ESCAPE '\\' OR p.sku ILIKE ${pattern} ESCAPE '\\' OR p.barcode = ${filter.search})`,
    );
  }
  if (filter.lowStock) {
    conditions.push(
      Prisma.sql`p.low_stock_threshold IS NOT NULL AND COALESCE((
        SELECT l.quantity FROM stock_levels l
        WHERE l.tenant_id = p.tenant_id AND l.product_id = p.id AND l.branch_id = ${branchId}::uuid
      ), 0) <= p.low_stock_threshold`,
    );
  }
  return Prisma.join(conditions, ' AND ');
}

/** Products with their category, stock at the given branch and unit-lock flag. */
export async function selectProducts(
  tx: TransactionClient,
  tenantId: string,
  branchId: string,
  filter: ProductFilter,
  page: { limit: number; offset: number },
): Promise<Product[]> {
  const rows = await tx.$queryRaw<ProductRow[]>`
    SELECT p.id, p.name, p.sku, p.barcode, p.unit::text AS unit, p.price_poisha, p.cost_poisha,
           p.vat_rate_bp, p.low_stock_threshold, p.archived_at, p.created_at, p.updated_at,
           c.id AS category_id, c.name AS category_name,
           COALESCE(l.quantity, 0) AS stock_quantity,
           EXISTS (
             SELECT 1 FROM stock_movements m WHERE m.tenant_id = p.tenant_id AND m.product_id = p.id
           ) AS unit_locked
    FROM products p
    LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
    LEFT JOIN stock_levels l
      ON l.tenant_id = p.tenant_id AND l.product_id = p.id AND l.branch_id = ${branchId}::uuid
    WHERE ${whereClause(tenantId, branchId, filter)}
    ORDER BY lower(p.name), p.id
    LIMIT ${page.limit} OFFSET ${page.offset}`;
  return rows.map(toProduct);
}

export async function countProducts(
  tx: TransactionClient,
  tenantId: string,
  branchId: string,
  filter: ProductFilter,
): Promise<number> {
  const [row] = await tx.$queryRaw<{ total: bigint }[]>`
    SELECT count(*) AS total FROM products p WHERE ${whereClause(tenantId, branchId, filter)}`;
  return Number(row?.total ?? 0);
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    category:
      row.category_id && row.category_name
        ? { id: row.category_id, name: row.category_name }
        : null,
    unit: row.unit,
    pricePoisha: row.price_poisha,
    costPoisha: row.cost_poisha,
    vatRateBp: row.vat_rate_bp,
    lowStockThreshold: row.low_stock_threshold,
    archived: row.archived_at !== null,
    stockQuantity: row.stock_quantity,
    isLowStock: isLowStock(row.stock_quantity, row.low_stock_threshold),
    unitLocked: row.unit_locked,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

import type { TransactionClient } from '@dokanflow/db';

/**
 * Branches exist in the data model but are hidden for the MVP (docs/SCHEMA.md,
 * decision 5): stock is kept at the shop's default branch. Runs under RLS.
 */
export async function defaultBranchId(tx: TransactionClient, tenantId: string): Promise<string> {
  const branch = await tx.branch.findFirst({
    where: { tenantId, isDefault: true },
    select: { id: true },
  });
  if (!branch) {
    throw new Error(`Tenant ${tenantId} has no default branch`);
  }
  return branch.id;
}

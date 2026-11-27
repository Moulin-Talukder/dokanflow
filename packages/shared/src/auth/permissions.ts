import type { MembershipRole } from './roles.js';

/**
 * Every server-side permission. The API checks these with @RequirePermission;
 * the web app reads them only to hide controls. Add new permissions in the
 * phase that introduces the feature.
 */
export const PERMISSIONS = [
  'tenant:read',
  'staff:read',
  'staff:create',
  'staff:reset-password',
  'catalog:read',
  'catalog:write',
  'stock:read',
  'stock:write',
  'sale:create',
  'sale:read',
  'sale:void',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly Permission[]>> = {
  owner: [
    'tenant:read',
    'staff:read',
    'staff:create',
    'staff:reset-password',
    'catalog:read',
    'catalog:write',
    'stock:read',
    'stock:write',
    'sale:create',
    'sale:read',
    'sale:void',
  ],
  // Stock changes and voids are "manager and above" (docs/ROADMAP.md).
  manager: [
    'tenant:read',
    'staff:read',
    'catalog:read',
    'catalog:write',
    'stock:read',
    'stock:write',
    'sale:create',
    'sale:read',
    'sale:void',
  ],
  // Cashiers sell and read products, stock and sales; they cannot change stock
  // directly or void a sale.
  cashier: ['tenant:read', 'catalog:read', 'stock:read', 'sale:create', 'sale:read'],
};

export function permissionsFor(role: MembershipRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

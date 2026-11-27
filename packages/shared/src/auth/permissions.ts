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
  ],
  // Stock changes are "manager and above" (docs/ROADMAP.md, Phase 3).
  manager: [
    'tenant:read',
    'staff:read',
    'catalog:read',
    'catalog:write',
    'stock:read',
    'stock:write',
  ],
  // Cashiers read products and stock (the POS needs them) but change nothing.
  cashier: ['tenant:read', 'catalog:read', 'stock:read'],
};

export function permissionsFor(role: MembershipRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

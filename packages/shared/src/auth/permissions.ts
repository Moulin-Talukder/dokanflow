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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly Permission[]>> = {
  owner: ['tenant:read', 'staff:read', 'staff:create', 'staff:reset-password'],
  manager: ['tenant:read', 'staff:read'],
  cashier: ['tenant:read'],
};

export function permissionsFor(role: MembershipRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function hasPermission(role: MembershipRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

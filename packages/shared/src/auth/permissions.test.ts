import { describe, expect, it } from 'vitest';
import { hasPermission, PERMISSIONS, permissionsFor, ROLE_PERMISSIONS } from './permissions.js';
import { membershipRoleSchema } from './roles.js';

describe('role permissions', () => {
  // The full matrix, spelled out, so any change to who can do what is a visible test change.
  const expected = {
    'tenant:read': { owner: true, manager: true, cashier: true },
    'staff:read': { owner: true, manager: true, cashier: false },
    'staff:create': { owner: true, manager: false, cashier: false },
    'staff:reset-password': { owner: true, manager: false, cashier: false },
  } as const;

  it('covers every permission in the expected matrix', () => {
    expect(Object.keys(expected).sort()).toEqual([...PERMISSIONS].sort());
  });

  for (const permission of PERMISSIONS) {
    for (const role of membershipRoleSchema.options) {
      const allowed = expected[permission][role];
      it(`${role} ${allowed ? 'can' : 'cannot'} ${permission}`, () => {
        expect(hasPermission(role, permission)).toBe(allowed);
      });
    }
  }

  it('gives owners every permission', () => {
    expect([...permissionsFor('owner')].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('never lists a permission twice for a role', () => {
    for (const perms of Object.values(ROLE_PERMISSIONS)) {
      expect(new Set(perms).size).toBe(perms.length);
    }
  });
});

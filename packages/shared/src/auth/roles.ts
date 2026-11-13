import { z } from 'zod';

export const membershipRoleSchema = z.enum(['owner', 'manager', 'cashier']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

/** Roles an owner can give to staff accounts they create. */
export const staffRoleSchema = z.enum(['manager', 'cashier']);
export type StaffRole = z.infer<typeof staffRoleSchema>;

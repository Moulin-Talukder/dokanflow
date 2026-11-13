import { z } from 'zod';
import { PERMISSIONS } from './permissions.js';
import { normalizeBdPhone } from './phone.js';
import { membershipRoleSchema } from './roles.js';

/** Header the web app sends on cookie-authenticated requests (CSRF defence). */
export const CSRF_HEADER = 'x-dokanflow-csrf';
export const CSRF_HEADER_VALUE = '1';

const nameSchema = z.string().trim().min(1, 'validation.required').max(100, 'validation.tooLong');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'validation.email' }).max(254, 'validation.tooLong'));

export const phoneSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeBdPhone(value);
  if (normalized === null) {
    ctx.addIssue({ code: 'custom', message: 'validation.phone' });
    return z.NEVER;
  }
  return normalized;
});

/**
 * Length is the only rule (NIST SP 800-63B): at least 10 characters, at most 128
 * so hashing cost stays bounded. No composition rules.
 */
export const passwordSchema = z
  .string()
  .min(10, 'validation.passwordMin')
  .max(128, 'validation.passwordMax');

export const registerRequestSchema = z.object({
  businessName: nameSchema,
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** `identifier` is an email (contains "@") or a phone number. */
export const loginRequestSchema = z.object({
  identifier: z.string().trim().min(1, 'validation.required').max(254, 'validation.tooLong'),
  // Not passwordSchema: never tell an attacker which length rule a guess failed.
  password: z.string().min(1, 'validation.required').max(128, 'validation.passwordMax'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, 'validation.required').max(128, 'validation.passwordMax'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'validation.passwordSame',
  });
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const createTenantRequestSchema = z.object({ businessName: nameSchema });
export type CreateTenantRequest = z.infer<typeof createTenantRequestSchema>;

export const switchTenantRequestSchema = z.object({ tenantId: z.uuid() });
export type SwitchTenantRequest = z.infer<typeof switchTenantRequestSchema>;

/** Managers sign in with email, cashiers with phone (docs/SCHEMA.md, decision 2). */
export const createStaffRequestSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('manager'),
    name: nameSchema,
    email: emailSchema,
    temporaryPassword: passwordSchema,
  }),
  z.object({
    role: z.literal('cashier'),
    name: nameSchema,
    phone: phoneSchema,
    temporaryPassword: passwordSchema,
  }),
]);
export type CreateStaffRequest = z.infer<typeof createStaffRequestSchema>;
export type CreateStaffInput = z.input<typeof createStaffRequestSchema>;

export const resetStaffPasswordRequestSchema = z.object({ temporaryPassword: passwordSchema });
export type ResetStaffPasswordRequest = z.infer<typeof resetStaffPasswordRequestSchema>;

// --- Responses --------------------------------------------------------------

export const membershipSummarySchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string(),
  role: membershipRoleSchema,
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const sessionSchema = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    mustChangePassword: z.boolean(),
  }),
  tenant: z.object({ id: z.uuid(), name: z.string() }),
  role: membershipRoleSchema,
  permissions: z.array(z.enum(PERMISSIONS)),
  memberships: z.array(membershipSummarySchema),
});
export type Session = z.infer<typeof sessionSchema>;

/** Returned by register, login, refresh, switch-tenant and change-password. */
export const authResponseSchema = z.object({
  accessToken: z.string(),
  /** Seconds until the access token expires. */
  expiresIn: z.number().int().positive(),
  session: sessionSchema,
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const staffMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: membershipRoleSchema,
  mustChangePassword: z.boolean(),
  /** True when this shop created the account, so its owner may reset the password. */
  managedByThisShop: z.boolean(),
  joinedAt: z.iso.datetime(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const staffListResponseSchema = z.object({ items: z.array(staffMemberSchema) });
export type StaffListResponse = z.infer<typeof staffListResponseSchema>;

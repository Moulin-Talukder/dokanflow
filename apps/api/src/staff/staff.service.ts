import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withDbContext } from '@dokanflow/db';
import type { CreateStaffRequest, ResetStaffPasswordRequest, StaffMember } from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { PasswordHasher } from '../auth/password-hasher.service.js';
import { revokeAllSessionsOfUser } from '../auth/prisma-refresh-token.store.js';
import { ApiHttpException } from '../common/api-http.exception.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordHasher,
  ) {}

  /** Members of the current shop. RLS limits the query to this tenant. */
  async list(auth: AuthContext): Promise<StaffMember[]> {
    const rows = await withDbContext(
      this.prisma.client,
      { tenantId: auth.tenantId, userId: auth.userId },
      (tx) =>
        tx.membership.findMany({
          where: { tenantId: auth.tenantId },
          orderBy: { createdAt: 'asc' },
          select: {
            role: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                mustChangePassword: true,
                managedByTenantId: true,
              },
            },
          },
        }),
    );
    return rows.map((row) => ({
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      phone: row.user.phone,
      role: row.role,
      mustChangePassword: row.user.mustChangePassword,
      managedByThisShop: row.user.managedByTenantId === auth.tenantId,
      joinedAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * Creates a new account with a temporary password and adds it to this shop.
   * An email or phone that already belongs to someone is refused: adding an
   * existing person needs their consent (invite links, out of scope).
   */
  async create(auth: AuthContext, input: CreateStaffRequest): Promise<StaffMember> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    try {
      const user = await withDbContext(
        this.prisma.client,
        { tenantId: auth.tenantId, userId: auth.userId },
        async (tx) => {
          const created = await tx.user.create({
            data: {
              name: input.name,
              email: input.role === 'manager' ? input.email : null,
              phone: input.role === 'cashier' ? input.phone : null,
              passwordHash,
              mustChangePassword: true,
              managedByTenantId: auth.tenantId,
              lastTenantId: auth.tenantId,
            },
          });
          const membership = await tx.membership.create({
            data: { tenantId: auth.tenantId, userId: created.id, role: input.role },
          });
          return { ...created, joinedAt: membership.createdAt };
        },
      );
      return {
        userId: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: input.role,
        mustChangePassword: true,
        managedByThisShop: true,
        joinedAt: user.joinedAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          input.role === 'manager'
            ? 'An account with this email already exists'
            : 'An account with this phone number already exists',
        );
      }
      throw error;
    }
  }

  /**
   * Sets a new temporary password and ends all of the person's sessions, in one
   * transaction with one fixed context (this shop, this owner).
   *
   * Allowed only while this shop still manages the account. A managed account can
   * only join another shop by starting its own business, and that clears
   * managed_by_tenant_id in the same transaction (TenantsService). So "managed by
   * this shop" also means "belongs to no other shop", without ever looking at
   * other shops' memberships. The conditional update makes the check atomic.
   */
  async resetPassword(
    auth: AuthContext,
    targetUserId: string,
    input: ResetStaffPasswordRequest,
  ): Promise<void> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    await withDbContext(
      this.prisma.client,
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: auth.tenantId, userId: targetUserId } },
          select: { role: true },
        });
        // RLS also guarantees this: another shop's member is simply not found.
        if (!membership) {
          throw new NotFoundException('Staff member not found');
        }
        if (membership.role === 'owner') {
          throw new ApiHttpException(403, 'FORBIDDEN', "An owner's password cannot be reset");
        }
        const now = new Date();
        const updated = await tx.user.updateMany({
          where: { id: targetUserId, managedByTenantId: auth.tenantId },
          data: { passwordHash, mustChangePassword: true, passwordChangedAt: now },
        });
        if (updated.count === 0) {
          throw new ApiHttpException(
            403,
            'FORBIDDEN',
            'Only the person can change this password: the account is not managed by this shop',
          );
        }
        await revokeAllSessionsOfUser(tx, targetUserId, now);
      },
    );
  }
}

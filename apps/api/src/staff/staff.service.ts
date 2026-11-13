import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { withDbContext } from '@dokanflow/db';
import type { CreateStaffRequest, ResetStaffPasswordRequest, StaffMember } from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { hashPassword } from '../auth/password-hasher.js';
import { RefreshTokenService } from '../auth/refresh-token.js';
import { ApiHttpException } from '../common/api-http.exception.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { PrismaService } from '../infra/prisma.service.js';

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokens: RefreshTokenService,
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
    const passwordHash = await hashPassword(input.temporaryPassword);
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
   * Sets a new temporary password. Allowed only for staff accounts this shop
   * created and that belong to no other shop; otherwise one shop's owner could
   * take over an account used elsewhere. Ends all of the user's sessions.
   */
  async resetPassword(
    auth: AuthContext,
    targetUserId: string,
    input: ResetStaffPasswordRequest,
  ): Promise<void> {
    const passwordHash = await hashPassword(input.temporaryPassword);
    await withDbContext(
      this.prisma.client,
      { tenantId: auth.tenantId, userId: auth.userId },
      async (tx) => {
        const membership = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: auth.tenantId, userId: targetUserId } },
          select: { role: true, user: { select: { managedByTenantId: true } } },
        });
        // RLS also guarantees this: another shop's member is simply not found.
        if (!membership) {
          throw new NotFoundException('Staff member not found');
        }
        if (membership.role === 'owner' || membership.user.managedByTenantId !== auth.tenantId) {
          throw new ApiHttpException(
            403,
            'FORBIDDEN',
            'You can only reset passwords of staff accounts created by this shop',
          );
        }
        // Look at the target's memberships everywhere. The self-read policy is
        // scoped to app.user_id, so switch it to the target for this check only.
        await tx.$executeRaw`SELECT set_config('app.user_id', ${targetUserId}, true)`;
        const elsewhere = await tx.membership.count({
          where: { userId: targetUserId, tenantId: { not: auth.tenantId } },
        });
        if (elsewhere > 0) {
          throw new ApiHttpException(
            403,
            'FORBIDDEN',
            'This person also belongs to another shop, so only they can change their password',
          );
        }
        await tx.user.update({
          where: { id: targetUserId },
          data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
        });
      },
    );
    await this.refreshTokens.revokeAllForUser(targetUserId);
  }
}

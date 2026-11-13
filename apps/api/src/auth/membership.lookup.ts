import { Injectable } from '@nestjs/common';
import { withDbContext } from '@dokanflow/db';
import type { MembershipRole } from '@dokanflow/shared';
import { PrismaService } from '../infra/prisma.service.js';

export interface MembershipStatus {
  role: MembershipRole;
  mustChangePassword: boolean;
  userStatus: 'active' | 'disabled';
  tenantStatus: 'active' | 'suspended';
}

export interface RequestAuthState extends MembershipStatus {
  /** The token's login session exists, belongs to the user, is not revoked and not expired. */
  sessionActive: boolean;
}

/**
 * Membership and session lookups. Tenant context is only ever taken from a
 * server-signed access token or from server-side data, never from request input.
 */
@Injectable()
export class MembershipLookup {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Per-request check for a verified access token: its tenant (`tid`) and session
   * (`sid`) are server-signed. One transaction: membership under RLS plus session.
   */
  async forAccessToken(claims: {
    sub: string;
    tid: string;
    sid: string;
  }): Promise<RequestAuthState | null> {
    const { sub: userId, tid: tenantId, sid: sessionId } = claims;
    const result = await withDbContext(this.prisma.client, { tenantId, userId }, async (tx) => {
      const session = await tx.authSession.findUnique({
        where: { id: sessionId },
        select: { userId: true, expiresAt: true, revokedAt: true },
      });
      const membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: {
          role: true,
          user: { select: { mustChangePassword: true, status: true } },
          tenant: { select: { status: true } },
        },
      });
      return { session, membership };
    });
    if (!result.membership) {
      return null;
    }
    const { session, membership } = result;
    return {
      ...toStatus(membership),
      sessionActive:
        session !== null &&
        session.userId === userId &&
        session.revokedAt === null &&
        session.expiresAt.getTime() > Date.now(),
    };
  }

  /**
   * Is the user a member of `tenantId`? Uses ONLY the user context (the
   * memberships self-read policy), so a shop id from the request never becomes
   * the RLS tenant context.
   */
  async findOwn(userId: string, tenantId: string): Promise<MembershipStatus | null> {
    const membership = await withDbContext(this.prisma.client, { tenantId: null, userId }, (tx) =>
      tx.membership.findFirst({
        where: { userId, tenantId },
        select: {
          role: true,
          user: { select: { mustChangePassword: true, status: true } },
          tenant: { select: { status: true } },
        },
      }),
    );
    return membership ? toStatus(membership) : null;
  }
}

function toStatus(membership: {
  role: MembershipRole;
  user: { mustChangePassword: boolean; status: 'active' | 'disabled' };
  tenant: { status: 'active' | 'suspended' };
}): MembershipStatus {
  return {
    role: membership.role,
    mustChangePassword: membership.user.mustChangePassword,
    userStatus: membership.user.status,
    tenantStatus: membership.tenant.status,
  };
}

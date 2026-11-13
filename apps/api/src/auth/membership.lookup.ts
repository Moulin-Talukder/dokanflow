import { Injectable } from '@nestjs/common';
import { withDbContext } from '@dokanflow/db';
import type { MembershipRole } from '@dokanflow/shared';
import { PrismaService } from '../infra/prisma.service.js';

export interface MembershipLookupResult {
  role: MembershipRole;
  mustChangePassword: boolean;
  passwordChangedAt: Date;
  userStatus: 'active' | 'disabled';
  tenantStatus: 'active' | 'suspended';
}

/** One query per request: the membership (under RLS) joined with its user and tenant. */
@Injectable()
export class MembershipLookup {
  constructor(private readonly prisma: PrismaService) {}

  async find(userId: string, tenantId: string): Promise<MembershipLookupResult | null> {
    const membership = await withDbContext(this.prisma.client, { tenantId, userId }, (tx) =>
      tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        select: {
          role: true,
          user: { select: { mustChangePassword: true, passwordChangedAt: true, status: true } },
          tenant: { select: { status: true } },
        },
      }),
    );
    if (!membership) {
      return null;
    }
    return {
      role: membership.role,
      mustChangePassword: membership.user.mustChangePassword,
      passwordChangedAt: membership.user.passwordChangedAt,
      userStatus: membership.user.status,
      tenantStatus: membership.tenant.status,
    };
  }
}

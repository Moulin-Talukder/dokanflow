import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { withDbContext } from '@dokanflow/db';
import type { CreateTenantRequest, MembershipSummary } from '@dokanflow/shared';
import type { AuthContext } from '../auth/auth-context.js';
import { createTenantWithOwner } from '../auth/auth.service.js';
import { PrismaService } from '../infra/prisma.service.js';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Any signed-in user can start another business, becoming its owner. */
  async create(auth: AuthContext, input: CreateTenantRequest): Promise<MembershipSummary> {
    const tenantId = randomUUID();
    await withDbContext(this.prisma.client, { tenantId, userId: auth.userId }, (tx) =>
      createTenantWithOwner(tx, {
        tenantId,
        userId: auth.userId,
        businessName: input.businessName,
      }),
    );
    return { tenantId, tenantName: input.businessName, role: 'owner' };
  }
}

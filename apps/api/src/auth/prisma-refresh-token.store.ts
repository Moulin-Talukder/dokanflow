import { Injectable } from '@nestjs/common';
import type { TransactionClient } from '@dokanflow/db';
import { PrismaService } from '../infra/prisma.service.js';
import type {
  NewRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
  RefreshTokenTx,
} from './refresh-token.js';

interface Row {
  id: string;
  user_id: string;
  tenant_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
}

class PrismaRefreshTokenTx implements RefreshTokenTx {
  constructor(private readonly tx: TransactionClient) {}

  async findByHashForUpdate(tokenHash: string): Promise<RefreshTokenRecord | null> {
    // FOR UPDATE serializes concurrent refreshes of the same token: the second one
    // waits, then sees replaced_by_id set and is treated as reuse.
    const rows = await this.tx.$queryRaw<Row[]>`
      SELECT id, user_id, tenant_id, family_id, expires_at, revoked_at, replaced_by_id
      FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          tenantId: row.tenant_id,
          familyId: row.family_id,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          replacedById: row.replaced_by_id,
        }
      : null;
  }

  async insert(token: NewRefreshToken): Promise<void> {
    await this.tx.refreshToken.create({ data: token });
  }

  async markReplaced(id: string, replacedById: string, _at: Date): Promise<void> {
    await this.tx.refreshToken.update({ where: { id }, data: { replacedById } });
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}

/** refresh_tokens is a global table (no RLS): it is read before any tenant context exists. */
@Injectable()
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: RefreshTokenTx) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction((tx) => fn(new PrismaRefreshTokenTx(tx)));
  }
}

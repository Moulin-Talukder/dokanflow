import { Injectable } from '@nestjs/common';
import type { TransactionClient } from '@dokanflow/db';
import { PrismaService } from '../infra/prisma.service.js';
import type {
  NewRefreshToken,
  RefreshTokenRecord,
  RefreshTokenStore,
  RefreshTokenTx,
  SessionRecord,
} from './refresh-token.js';

interface TokenRow {
  id: string;
  user_id: string;
  tenant_id: string;
  session_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
}

interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

/**
 * Revokes every session and refresh token of a user inside the caller's transaction,
 * so a password change and the end of the old sessions commit together.
 */
export async function revokeAllSessionsOfUser(
  tx: TransactionClient,
  userId: string,
  at: Date,
): Promise<void> {
  await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
  await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: at } });
}

class PrismaRefreshTokenTx implements RefreshTokenTx {
  constructor(private readonly tx: TransactionClient) {}

  async findByHashForUpdate(tokenHash: string): Promise<RefreshTokenRecord | null> {
    // FOR UPDATE serializes concurrent refreshes of the same token: the second one
    // waits, then sees replaced_by_id set and is treated as reuse.
    const rows = await this.tx.$queryRaw<TokenRow[]>`
      SELECT id, user_id, tenant_id, session_id, expires_at, revoked_at, replaced_by_id
      FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          tenantId: row.tenant_id,
          sessionId: row.session_id,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          replacedById: row.replaced_by_id,
        }
      : null;
  }

  async findSessionForUpdate(sessionId: string): Promise<SessionRecord | null> {
    const rows = await this.tx.$queryRaw<SessionRow[]>`
      SELECT id, user_id, expires_at, revoked_at
      FROM auth_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const row = rows[0];
    return row
      ? { id: row.id, userId: row.user_id, expiresAt: row.expires_at, revokedAt: row.revoked_at }
      : null;
  }

  async insertSession(session: SessionRecord): Promise<void> {
    await this.tx.authSession.create({ data: session });
  }

  async insert(token: NewRefreshToken): Promise<void> {
    await this.tx.refreshToken.create({ data: token });
  }

  async markReplaced(id: string, replacedById: string): Promise<void> {
    await this.tx.refreshToken.update({ where: { id }, data: { replacedById } });
  }

  async revokeSession(sessionId: string, at: Date): Promise<void> {
    await this.tx.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: at },
    });
    await this.tx.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: at },
    });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await revokeAllSessionsOfUser(this.tx, userId, at);
  }
}

/** auth_sessions and refresh_tokens are global tables (no RLS), read before any tenant context exists. */
@Injectable()
export class PrismaRefreshTokenStore implements RefreshTokenStore {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: RefreshTokenTx) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction((tx) => fn(new PrismaRefreshTokenTx(tx)));
  }
}

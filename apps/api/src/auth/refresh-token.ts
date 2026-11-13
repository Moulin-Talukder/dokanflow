import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** What the server keeps about a refresh token. The token itself is never stored. */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tenantId: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

export interface NewRefreshToken {
  id: string;
  userId: string;
  tenantId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

/** Storage operations used by RefreshTokenService. All run inside one transaction. */
export interface RefreshTokenTx {
  /** Finds a token by hash and locks its row until the transaction ends. */
  findByHashForUpdate(tokenHash: string): Promise<RefreshTokenRecord | null>;
  insert(token: NewRefreshToken): Promise<void>;
  markReplaced(id: string, replacedById: string, at: Date): Promise<void>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export interface RefreshTokenStore {
  transaction<T>(fn: (tx: RefreshTokenTx) => Promise<T>): Promise<T>;
}

/** 256 bits of randomness, URL-safe. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * SHA-256 is enough here (no salt or slow hash): the token is 256 random bits,
 * so it cannot be guessed or brute-forced the way a password can.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export type RotationDecision = 'rotate' | 'reused' | 'expired';

/**
 * A token that was already replaced or revoked is being presented again: either a
 * stolen copy or a replay. Both are treated as compromise of the whole family.
 */
export function decideRotation(record: RefreshTokenRecord, now: Date): RotationDecision {
  if (record.revokedAt !== null || record.replacedById !== null) {
    return 'reused';
  }
  if (record.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'rotate';
}

export interface ClientMeta {
  userAgent: string | null;
  ip: string | null;
}

export type RotateResult =
  | { status: 'rotated'; token: string; record: RefreshTokenRecord }
  | { status: 'reused'; userId: string; familyId: string }
  | { status: 'expired' }
  | { status: 'invalid' };

/**
 * Issues, rotates and revokes opaque refresh tokens. Pure logic over a store, so
 * it is unit-tested with an in-memory store and integration-tested with Postgres.
 */
export class RefreshTokenService {
  constructor(
    private readonly store: RefreshTokenStore,
    private readonly ttlMs: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Starts a new session (a new family). */
  async issue(
    userId: string,
    tenantId: string,
    meta: ClientMeta,
  ): Promise<{ token: string; record: RefreshTokenRecord }> {
    return this.store.transaction((tx) =>
      this.insertToken(tx, userId, tenantId, randomUUID(), meta),
    );
  }

  /**
   * Exchanges a valid token for a new one in the same family. `tenantId`
   * overrides the session's shop (used by switch-tenant); `expectedUserId`
   * rejects a token that belongs to someone else.
   */
  async rotate(
    presented: string,
    meta: ClientMeta,
    options: { tenantId?: string; expectedUserId?: string } = {},
  ): Promise<RotateResult> {
    const now = this.clock();
    return this.store.transaction(async (tx) => {
      const record = await tx.findByHashForUpdate(hashRefreshToken(presented));
      if (!record) {
        return { status: 'invalid' };
      }
      if (options.expectedUserId !== undefined && record.userId !== options.expectedUserId) {
        return { status: 'invalid' };
      }
      const decision = decideRotation(record, now);
      if (decision === 'reused') {
        // Committed even though the request fails: the family stays revoked.
        await tx.revokeFamily(record.familyId, now);
        return { status: 'reused', userId: record.userId, familyId: record.familyId };
      }
      if (decision === 'expired') {
        return { status: 'expired' };
      }
      const next = await this.insertToken(
        tx,
        record.userId,
        options.tenantId ?? record.tenantId,
        record.familyId,
        meta,
      );
      await tx.markReplaced(record.id, next.record.id, now);
      return { status: 'rotated', token: next.token, record: next.record };
    });
  }

  /** Logout: revokes the presented token's whole session. Unknown tokens are ignored. */
  async revokeSession(presented: string): Promise<void> {
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const record = await tx.findByHashForUpdate(hashRefreshToken(presented));
      if (record) {
        await tx.revokeFamily(record.familyId, now);
      }
    });
  }

  /** Password change or reset: ends every session of the user. */
  async revokeAllForUser(userId: string): Promise<void> {
    const now = this.clock();
    await this.store.transaction((tx) => tx.revokeAllForUser(userId, now));
  }

  private async insertToken(
    tx: RefreshTokenTx,
    userId: string,
    tenantId: string,
    familyId: string,
    meta: ClientMeta,
  ): Promise<{ token: string; record: RefreshTokenRecord }> {
    const token = generateRefreshToken();
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId,
      tenantId,
      familyId,
      expiresAt: new Date(this.clock().getTime() + this.ttlMs),
      revokedAt: null,
      replacedById: null,
    };
    await tx.insert({
      ...record,
      tokenHash: hashRefreshToken(token),
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
      ip: meta.ip,
    });
    return { token, record };
  }
}

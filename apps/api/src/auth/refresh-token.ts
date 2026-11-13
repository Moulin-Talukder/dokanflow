import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** What the server keeps about a refresh token. The token itself is never stored. */
export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tenantId: string;
  sessionId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/** A login session. Its expiry is fixed at login; rotation never extends it. */
export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface NewRefreshToken {
  id: string;
  userId: string;
  tenantId: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

/** Storage operations used by RefreshTokenService. All run inside one transaction. */
export interface RefreshTokenTx {
  /** Finds a token by hash and locks its row until the transaction ends. */
  findByHashForUpdate(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /** Locks the session row, so rotation and revocation of one session serialize. */
  findSessionForUpdate(sessionId: string): Promise<SessionRecord | null>;
  insertSession(session: SessionRecord): Promise<void>;
  insert(token: NewRefreshToken): Promise<void>;
  markReplaced(id: string, replacedById: string): Promise<void>;
  /** Revokes the session and all of its refresh tokens. */
  revokeSession(sessionId: string, at: Date): Promise<void>;
  /** Revokes every session (and refresh token) of a user. */
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
 * A token that was already replaced or revoked, or whose session was revoked, is
 * being presented again: a stolen copy or a replay. Both revoke the whole session.
 */
export function decideRotation(
  record: RefreshTokenRecord,
  session: SessionRecord,
  now: Date,
): RotationDecision {
  if (record.revokedAt !== null || record.replacedById !== null || session.revokedAt !== null) {
    return 'reused';
  }
  if (record.expiresAt.getTime() <= now.getTime() || session.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'rotate';
}

export interface ClientMeta {
  userAgent: string | null;
  ip: string | null;
}

export interface IssuedRefreshToken {
  token: string;
  record: RefreshTokenRecord;
}

export type RotateResult =
  | ({ status: 'rotated' } & IssuedRefreshToken)
  | { status: 'reused'; userId: string; sessionId: string }
  | { status: 'expired' }
  | { status: 'invalid' };

export interface RefreshTokenServiceOptions {
  /** Idle lifetime of one refresh token. */
  refreshTtlMs: number;
  /** Absolute lifetime of a login session. */
  sessionMaxAgeMs: number;
  clock?: () => Date;
}

/**
 * Issues, rotates and revokes opaque refresh tokens grouped into login sessions.
 * Pure logic over a store, so it is unit-tested with an in-memory store and
 * integration-tested with Postgres.
 */
export class RefreshTokenService {
  private readonly clock: () => Date;

  constructor(
    private readonly store: RefreshTokenStore,
    private readonly options: RefreshTokenServiceOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  /** Starts a new login session with a fixed absolute expiry. */
  async issue(userId: string, tenantId: string, meta: ClientMeta): Promise<IssuedRefreshToken> {
    const now = this.clock();
    const session: SessionRecord = {
      id: randomUUID(),
      userId,
      expiresAt: new Date(now.getTime() + this.options.sessionMaxAgeMs),
      revokedAt: null,
    };
    return this.store.transaction(async (tx) => {
      await tx.insertSession(session);
      return this.insertToken(tx, session, tenantId, meta, now);
    });
  }

  /**
   * Exchanges a valid token for a new one in the same session. `tenantId`
   * overrides the session's shop (switch-tenant); `expectedUserId` rejects a token
   * that belongs to someone else.
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
      const session = await tx.findSessionForUpdate(record.sessionId);
      if (!session) {
        return { status: 'invalid' };
      }
      const decision = decideRotation(record, session, now);
      if (decision === 'reused') {
        // Committed even though the request fails: the session stays revoked.
        await tx.revokeSession(session.id, now);
        return { status: 'reused', userId: record.userId, sessionId: session.id };
      }
      if (decision === 'expired') {
        return { status: 'expired' };
      }
      const next = await this.insertToken(
        tx,
        session,
        options.tenantId ?? record.tenantId,
        meta,
        now,
      );
      await tx.markReplaced(record.id, next.record.id);
      return { status: 'rotated', ...next };
    });
  }

  /** Logout: revokes the presented token's whole session. Unknown tokens are ignored. */
  async revokeSessionByToken(presented: string): Promise<void> {
    const now = this.clock();
    await this.store.transaction(async (tx) => {
      const record = await tx.findByHashForUpdate(hashRefreshToken(presented));
      if (record) {
        await tx.revokeSession(record.sessionId, now);
      }
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    const now = this.clock();
    await this.store.transaction((tx) => tx.revokeSession(sessionId, now));
  }

  /** Password change or reset: ends every session of the user. */
  async revokeAllForUser(userId: string): Promise<void> {
    const now = this.clock();
    await this.store.transaction((tx) => tx.revokeAllForUser(userId, now));
  }

  private async insertToken(
    tx: RefreshTokenTx,
    session: SessionRecord,
    tenantId: string,
    meta: ClientMeta,
    now: Date,
  ): Promise<IssuedRefreshToken> {
    const token = generateRefreshToken();
    const record: RefreshTokenRecord = {
      id: randomUUID(),
      userId: session.userId,
      tenantId,
      sessionId: session.id,
      // Rotation can never push a token past the session's absolute end.
      expiresAt: new Date(
        Math.min(now.getTime() + this.options.refreshTtlMs, session.expiresAt.getTime()),
      ),
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

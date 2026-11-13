import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  decideRotation,
  hashRefreshToken,
  type NewRefreshToken,
  type RefreshTokenRecord,
  RefreshTokenService,
  type RefreshTokenStore,
  type RefreshTokenTx,
  type SessionRecord,
} from './refresh-token.js';

type TokenRow = NewRefreshToken & { revokedAt: Date | null; replacedById: string | null };

/** Behaves like auth_sessions + refresh_tokens, including all-or-nothing transactions. */
class InMemoryStore implements RefreshTokenStore {
  tokens = new Map<string, TokenRow>();
  sessions = new Map<string, SessionRecord>();

  async transaction<T>(fn: (tx: RefreshTokenTx) => Promise<T>): Promise<T> {
    const snapshot = {
      tokens: new Map([...this.tokens].map(([k, v]) => [k, { ...v }])),
      sessions: new Map([...this.sessions].map(([k, v]) => [k, { ...v }])),
    };
    const revokeTokens = (match: (row: TokenRow) => boolean, at: Date) => {
      for (const row of this.tokens.values()) {
        if (match(row) && row.revokedAt === null) row.revokedAt = at;
      }
    };
    const tx: RefreshTokenTx = {
      findByHashForUpdate: (hash) => {
        const row = [...this.tokens.values()].find((r) => r.tokenHash === hash);
        return Promise.resolve(
          row
            ? {
                id: row.id,
                userId: row.userId,
                tenantId: row.tenantId,
                sessionId: row.sessionId,
                expiresAt: row.expiresAt,
                revokedAt: row.revokedAt,
                replacedById: row.replacedById,
              }
            : null,
        );
      },
      findSessionForUpdate: (id) => {
        const session = this.sessions.get(id);
        return Promise.resolve(session ? { ...session } : null);
      },
      insertSession: (session) => {
        this.sessions.set(session.id, { ...session });
        return Promise.resolve();
      },
      insert: (token) => {
        this.tokens.set(token.id, { ...token, revokedAt: null, replacedById: null });
        return Promise.resolve();
      },
      markReplaced: (id, replacedById) => {
        const row = this.tokens.get(id);
        if (row) row.replacedById = replacedById;
        return Promise.resolve();
      },
      revokeSession: (sessionId, at) => {
        const session = this.sessions.get(sessionId);
        if (session?.revokedAt === null) session.revokedAt = at;
        revokeTokens((row) => row.sessionId === sessionId, at);
        return Promise.resolve();
      },
      revokeAllForUser: (userId, at) => {
        for (const session of this.sessions.values()) {
          if (session.userId === userId && session.revokedAt === null) session.revokedAt = at;
        }
        revokeTokens((row) => row.userId === userId, at);
        return Promise.resolve();
      },
    };
    try {
      return await fn(tx);
    } catch (error) {
      this.tokens = snapshot.tokens;
      this.sessions = snapshot.sessions;
      throw error;
    }
  }
}

const DAY = 24 * 60 * 60 * 1000;
const meta = { userAgent: 'vitest', ip: '127.0.0.1' };
const USER = randomUUID();
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

describe('RefreshTokenService', () => {
  let store: InMemoryStore;
  let now: Date;
  let service: RefreshTokenService;

  beforeEach(() => {
    store = new InMemoryStore();
    now = new Date('2026-11-13T10:00:00Z');
    service = new RefreshTokenService(store, {
      refreshTtlMs: 14 * DAY,
      sessionMaxAgeMs: 30 * DAY,
      clock: () => now,
    });
  });

  it('stores only a SHA-256 hash of the token', async () => {
    const { token } = await service.issue(USER, TENANT_A, meta);
    const [row] = [...store.tokens.values()];
    expect(row?.tokenHash).toBe(hashRefreshToken(token));
    expect(JSON.stringify([...store.tokens.values()])).not.toContain(token);
  });

  it('starts a new session for each login, with a fixed absolute expiry', async () => {
    const first = await service.issue(USER, TENANT_A, meta);
    const second = await service.issue(USER, TENANT_A, meta);
    expect(first.record.sessionId).not.toBe(second.record.sessionId);
    expect(store.sessions.get(first.record.sessionId)?.expiresAt).toEqual(
      new Date(now.getTime() + 30 * DAY),
    );
    expect(first.record.expiresAt).toEqual(new Date(now.getTime() + 14 * DAY));
  });

  describe('rotation', () => {
    it('exchanges a valid token for a new one in the same session', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      const result = await service.rotate(issued.token, meta);

      expect(result.status).toBe('rotated');
      if (result.status !== 'rotated') return;
      expect(result.token).not.toBe(issued.token);
      expect(result.record.sessionId).toBe(issued.record.sessionId);
      expect(store.tokens.get(issued.record.id)?.replacedById).toBe(result.record.id);
    });

    it('can move the session to another tenant (switch-tenant)', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      const result = await service.rotate(issued.token, meta, { tenantId: TENANT_B });
      expect(result.status === 'rotated' && result.record.tenantId).toBe(TENANT_B);
    });

    it('rejects an unknown token without changing anything', async () => {
      await service.issue(USER, TENANT_A, meta);
      const before = JSON.stringify([...store.tokens.values()]);
      expect(await service.rotate('not-a-real-token', meta)).toEqual({ status: 'invalid' });
      expect(JSON.stringify([...store.tokens.values()])).toBe(before);
    });

    it("rejects someone else's token when the caller's identity is known", async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      expect(await service.rotate(issued.token, meta, { expectedUserId: randomUUID() })).toEqual({
        status: 'invalid',
      });
      expect(store.tokens.get(issued.record.id)?.replacedById).toBeNull();
    });

    it('rejects an idle-expired token and issues nothing', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      now = new Date(now.getTime() + 14 * DAY);
      expect(await service.rotate(issued.token, meta)).toEqual({ status: 'expired' });
      expect(store.tokens.size).toBe(1);
    });
  });

  describe('absolute session lifetime', () => {
    it('never issues a token that outlives the session', async () => {
      let { token } = await service.issue(USER, TENANT_A, meta);
      const sessionEnd = now.getTime() + 30 * DAY;
      // Refresh every 10 days: day 10 and day 20 succeed; tokens are capped at day 30.
      for (const day of [10, 20]) {
        now = new Date(Date.parse('2026-11-13T10:00:00Z') + day * DAY);
        const result = await service.rotate(token, meta);
        if (result.status !== 'rotated') throw new Error(`expected rotation on day ${String(day)}`);
        expect(result.record.expiresAt.getTime()).toBeLessThanOrEqual(sessionEnd);
        token = result.token;
      }
      // Day 20's token expires exactly at the session end (day 30), not day 34.
      const last = [...store.tokens.values()].at(-1);
      expect(last?.expiresAt.getTime()).toBe(sessionEnd);
    });

    it('refuses to rotate once the session has ended, however recently the token was used', async () => {
      let { token } = await service.issue(USER, TENANT_A, meta);
      for (let day = 5; day < 30; day += 5) {
        now = new Date(Date.parse('2026-11-13T10:00:00Z') + day * DAY);
        const result = await service.rotate(token, meta);
        if (result.status !== 'rotated') throw new Error('expected rotation');
        token = result.token;
      }
      now = new Date(Date.parse('2026-11-13T10:00:00Z') + 30 * DAY);
      expect(await service.rotate(token, meta)).toEqual({ status: 'expired' });
    });
  });

  describe('reuse detection', () => {
    it('treats a second use of a rotated token as theft and revokes the whole session', async () => {
      const original = await service.issue(USER, TENANT_A, meta);
      const rotated = await service.rotate(original.token, meta);
      if (rotated.status !== 'rotated') throw new Error('expected rotation');

      const replay = await service.rotate(original.token, meta);
      expect(replay).toEqual({
        status: 'reused',
        userId: USER,
        sessionId: original.record.sessionId,
      });
      expect(store.sessions.get(original.record.sessionId)?.revokedAt).toEqual(now);

      // The legitimate holder's newer token is dead too.
      expect((await service.rotate(rotated.token, meta)).status).toBe('reused');
    });

    it('only revokes the compromised session, not other sessions', async () => {
      const laptop = await service.issue(USER, TENANT_A, meta);
      const phone = await service.issue(USER, TENANT_A, meta);
      await service.rotate(laptop.token, meta);
      await service.rotate(laptop.token, meta); // reuse
      expect((await service.rotate(phone.token, meta)).status).toBe('rotated');
    });

    it('treats a logged-out token as reused', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      await service.revokeSessionByToken(issued.token);
      expect(store.sessions.get(issued.record.sessionId)?.revokedAt).not.toBeNull();
      expect((await service.rotate(issued.token, meta)).status).toBe('reused');
    });
  });

  it('revokeAllForUser ends every session of that user only', async () => {
    const mine = await service.issue(USER, TENANT_A, meta);
    const other = await service.issue(randomUUID(), TENANT_A, meta);
    await service.revokeAllForUser(USER);

    expect(store.sessions.get(mine.record.sessionId)?.revokedAt).not.toBeNull();
    expect((await service.rotate(mine.token, meta)).status).toBe('reused');
    expect((await service.rotate(other.token, meta)).status).toBe('rotated');
  });

  it('ignores logout with an unknown token', async () => {
    await expect(service.revokeSessionByToken('unknown')).resolves.toBeUndefined();
  });
});

describe('decideRotation', () => {
  const now = new Date('2026-11-13T10:00:00Z');
  const session: SessionRecord = {
    id: randomUUID(),
    userId: USER,
    expiresAt: new Date(now.getTime() + DAY),
    revokedAt: null,
  };
  const base: RefreshTokenRecord = {
    id: randomUUID(),
    userId: USER,
    tenantId: TENANT_A,
    sessionId: session.id,
    expiresAt: new Date(now.getTime() + 1000),
    revokedAt: null,
    replacedById: null,
  };

  it('rotates a live token in a live session', () => {
    expect(decideRotation(base, session, now)).toBe('rotate');
  });

  it('flags replaced or revoked tokens, or a revoked session, as reuse', () => {
    expect(decideRotation({ ...base, replacedById: randomUUID() }, session, now)).toBe('reused');
    expect(decideRotation({ ...base, revokedAt: now }, session, now)).toBe('reused');
    expect(decideRotation(base, { ...session, revokedAt: now }, now)).toBe('reused');
  });

  it('expires at the token expiry or the session expiry, whichever comes first', () => {
    expect(decideRotation({ ...base, expiresAt: now }, session, now)).toBe('expired');
    expect(decideRotation(base, { ...session, expiresAt: now }, now)).toBe('expired');
  });
});

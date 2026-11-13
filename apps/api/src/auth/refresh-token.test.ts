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
} from './refresh-token.js';

/** Behaves like the refresh_tokens table, including all-or-nothing transactions. */
class InMemoryStore implements RefreshTokenStore {
  rows = new Map<
    string,
    NewRefreshToken & { revokedAt: Date | null; replacedById: string | null }
  >();

  async transaction<T>(fn: (tx: RefreshTokenTx) => Promise<T>): Promise<T> {
    const snapshot = new Map([...this.rows].map(([k, v]) => [k, { ...v }]));
    const tx: RefreshTokenTx = {
      findByHashForUpdate: (hash) => {
        const row = [...this.rows.values()].find((r) => r.tokenHash === hash);
        return Promise.resolve(row ? toRecord(row) : null);
      },
      insert: (token) => {
        this.rows.set(token.id, { ...token, revokedAt: null, replacedById: null });
        return Promise.resolve();
      },
      markReplaced: (id, replacedById) => {
        const row = this.rows.get(id);
        if (row) row.replacedById = replacedById;
        return Promise.resolve();
      },
      revokeFamily: (familyId, at) => {
        for (const row of this.rows.values()) {
          if (row.familyId === familyId && row.revokedAt === null) row.revokedAt = at;
        }
        return Promise.resolve();
      },
      revokeAllForUser: (userId, at) => {
        for (const row of this.rows.values()) {
          if (row.userId === userId && row.revokedAt === null) row.revokedAt = at;
        }
        return Promise.resolve();
      },
    };
    try {
      return await fn(tx);
    } catch (error) {
      this.rows = snapshot;
      throw error;
    }
  }
}

function toRecord(
  row: InMemoryStore['rows'] extends Map<string, infer R> ? R : never,
): RefreshTokenRecord {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    familyId: row.familyId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    replacedById: row.replacedById,
  };
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
    now = new Date('2026-11-04T10:00:00Z');
    service = new RefreshTokenService(store, 30 * DAY, () => now);
  });

  it('stores only a SHA-256 hash of the token', async () => {
    const { token } = await service.issue(USER, TENANT_A, meta);
    const [row] = [...store.rows.values()];
    expect(row?.tokenHash).toBe(hashRefreshToken(token));
    expect(row?.tokenHash).not.toContain(token);
    expect(JSON.stringify([...store.rows.values()])).not.toContain(token);
  });

  it('issues a new family for each login', async () => {
    const first = await service.issue(USER, TENANT_A, meta);
    const second = await service.issue(USER, TENANT_A, meta);
    expect(first.record.familyId).not.toBe(second.record.familyId);
  });

  describe('rotation', () => {
    it('exchanges a valid token for a new one in the same family', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      const result = await service.rotate(issued.token, meta);

      expect(result.status).toBe('rotated');
      if (result.status !== 'rotated') return;
      expect(result.token).not.toBe(issued.token);
      expect(result.record.familyId).toBe(issued.record.familyId);
      expect(result.record.tenantId).toBe(TENANT_A);
      expect(store.rows.get(issued.record.id)?.replacedById).toBe(result.record.id);
    });

    it('keeps rotating along the chain', async () => {
      let token = (await service.issue(USER, TENANT_A, meta)).token;
      for (let i = 0; i < 5; i++) {
        const result = await service.rotate(token, meta);
        expect(result.status).toBe('rotated');
        if (result.status === 'rotated') token = result.token;
      }
      expect(store.rows.size).toBe(6);
    });

    it('can move the session to another tenant (switch-tenant)', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      const result = await service.rotate(issued.token, meta, { tenantId: TENANT_B });
      expect(result.status === 'rotated' && result.record.tenantId).toBe(TENANT_B);
    });

    it('rejects an unknown token without changing anything', async () => {
      await service.issue(USER, TENANT_A, meta);
      const before = JSON.stringify([...store.rows.values()]);
      expect(await service.rotate('not-a-real-token', meta)).toEqual({ status: 'invalid' });
      expect(JSON.stringify([...store.rows.values()])).toBe(before);
    });

    it("rejects someone else's token when the caller's identity is known", async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      const result = await service.rotate(issued.token, meta, { expectedUserId: randomUUID() });
      expect(result).toEqual({ status: 'invalid' });
      expect(store.rows.get(issued.record.id)?.replacedById).toBeNull();
    });

    it('rejects an expired token and issues nothing', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      now = new Date(now.getTime() + 30 * DAY);
      expect(await service.rotate(issued.token, meta)).toEqual({ status: 'expired' });
      expect(store.rows.size).toBe(1);
    });
  });

  describe('reuse detection', () => {
    it('treats a second use of a rotated token as theft and revokes the whole family', async () => {
      const original = await service.issue(USER, TENANT_A, meta);
      const rotated = await service.rotate(original.token, meta);
      if (rotated.status !== 'rotated') throw new Error('expected rotation');

      // An attacker replays the old token.
      const replay = await service.rotate(original.token, meta);
      expect(replay).toEqual({
        status: 'reused',
        userId: USER,
        familyId: original.record.familyId,
      });

      // The legitimate holder's newer token is now dead too.
      const victim = await service.rotate(rotated.token, meta);
      expect(victim.status).toBe('reused');
      for (const row of store.rows.values()) {
        expect(row.revokedAt).not.toBeNull();
      }
    });

    it('only revokes the compromised family, not other sessions', async () => {
      const laptop = await service.issue(USER, TENANT_A, meta);
      const phone = await service.issue(USER, TENANT_A, meta);
      await service.rotate(laptop.token, meta);
      await service.rotate(laptop.token, meta); // reuse

      const phoneResult = await service.rotate(phone.token, meta);
      expect(phoneResult.status).toBe('rotated');
    });

    it('treats a logged-out token as reused', async () => {
      const issued = await service.issue(USER, TENANT_A, meta);
      await service.revokeSession(issued.token);
      expect((await service.rotate(issued.token, meta)).status).toBe('reused');
    });
  });

  it('revokeAllForUser ends every session of that user only', async () => {
    const mine = await service.issue(USER, TENANT_A, meta);
    const other = await service.issue(randomUUID(), TENANT_A, meta);
    await service.revokeAllForUser(USER);

    expect((await service.rotate(mine.token, meta)).status).toBe('reused');
    expect((await service.rotate(other.token, meta)).status).toBe('rotated');
  });

  it('ignores logout with an unknown token', async () => {
    await expect(service.revokeSession('unknown')).resolves.toBeUndefined();
  });
});

describe('decideRotation', () => {
  const now = new Date('2026-11-04T10:00:00Z');
  const base: RefreshTokenRecord = {
    id: randomUUID(),
    userId: USER,
    tenantId: TENANT_A,
    familyId: randomUUID(),
    expiresAt: new Date(now.getTime() + 1000),
    revokedAt: null,
    replacedById: null,
  };

  it('rotates a live token', () => {
    expect(decideRotation(base, now)).toBe('rotate');
  });

  it('flags replaced or revoked tokens as reuse, even when also expired', () => {
    expect(decideRotation({ ...base, replacedById: randomUUID() }, now)).toBe('reused');
    expect(decideRotation({ ...base, revokedAt: now }, now)).toBe('reused');
    expect(
      decideRotation({ ...base, revokedAt: now, expiresAt: new Date(now.getTime() - 1) }, now),
    ).toBe('reused');
  });

  it('expires a token exactly at its expiry instant', () => {
    expect(decideRotation({ ...base, expiresAt: now }, now)).toBe('expired');
  });
});

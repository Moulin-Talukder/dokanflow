import { randomUUID } from 'node:crypto';
import { SignJWT, UnsecuredJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessTokenService, InvalidAccessTokenError } from './access-token.service.js';
import { testEnv } from './test-env.js';

const ids = { userId: randomUUID(), tenantId: randomUUID(), sessionId: randomUUID() };

describe('AccessTokenService', () => {
  const service = new AccessTokenService(testEnv());

  afterEach(() => {
    vi.useRealTimers();
  });

  it('round-trips user, tenant and session ids', async () => {
    const claims = await service.verify(await service.sign(ids));
    expect(claims).toMatchObject({ sub: ids.userId, tid: ids.tenantId, sid: ids.sessionId });
    expect(typeof claims.iat).toBe('number');
  });

  it('rejects a token signed with another secret', async () => {
    const other = new AccessTokenService(testEnv({ JWT_ACCESS_SECRET: 'x'.repeat(40) }));
    await expect(service.verify(await other.sign(ids))).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a tampered payload', async () => {
    const [header, , signature] = (await service.sign(ids)).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: ids.userId, tid: randomUUID() })).toString(
      'base64url',
    );
    await expect(service.verify(`${header ?? ''}.${forged}.${signature ?? ''}`)).rejects.toThrow(
      InvalidAccessTokenError,
    );
  });

  it('rejects unsigned (alg "none") tokens', async () => {
    const unsigned = new UnsecuredJWT({ tid: ids.tenantId, sid: ids.sessionId })
      .setSubject(ids.userId)
      .setIssuer('dokanflow-api')
      .setAudience('dokanflow')
      .setIssuedAt()
      .setExpirationTime('5m')
      .encode();
    await expect(service.verify(unsigned)).rejects.toThrow(InvalidAccessTokenError);
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-04T10:00:00Z') });
    const token = await service.sign(ids);
    vi.setSystemTime(new Date('2026-11-04T10:16:00Z'));
    await expect(service.verify(token)).rejects.toThrow('expired');
  });

  it('rejects correctly signed tokens with missing or malformed claims', async () => {
    const key = new TextEncoder().encode(testEnv().JWT_ACCESS_SECRET);
    const token = await new SignJWT({ tid: 'not-a-uuid', sid: ids.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ids.userId)
      .setIssuer('dokanflow-api')
      .setAudience('dokanflow')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    await expect(service.verify(token)).rejects.toThrow('malformed claims');
  });
});

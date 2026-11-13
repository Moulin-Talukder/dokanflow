import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { type TransactionClient, withDbContext } from '@dokanflow/db';
import {
  type AuthResponse,
  type ChangePasswordRequest,
  type LoginRequest,
  normalizeBdPhone,
  permissionsFor,
  type RegisterRequest,
  type Session,
} from '@dokanflow/shared';
import { ApiHttpException } from '../common/api-http.exception.js';
import { isUniqueViolation } from '../common/prisma-errors.js';
import { RequestValidationException } from '../common/request-validation.exception.js';
import { PrismaService } from '../infra/prisma.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { AuthContext } from './auth-context.js';
import { MembershipLookup } from './membership.lookup.js';
import { getDummyPasswordHash, hashPassword, verifyPassword } from './password-hasher.js';
import { type ClientMeta, RefreshTokenService } from './refresh-token.js';

/** What the controller needs: the JSON body, plus the refresh token to put in the cookie. */
export interface IssuedSession {
  body: AuthResponse;
  refreshToken: string;
}

const DEFAULT_BRANCH_NAME = 'Main branch';

/** Creates a tenant with its default branch and an owner membership. Used by register and create-tenant. */
export async function createTenantWithOwner(
  tx: TransactionClient,
  input: { tenantId: string; userId: string; businessName: string },
): Promise<void> {
  await tx.tenant.create({ data: { id: input.tenantId, name: input.businessName } });
  await tx.branch.create({
    data: { tenantId: input.tenantId, name: DEFAULT_BRANCH_NAME, isDefault: true },
  });
  await tx.membership.create({
    data: { tenantId: input.tenantId, userId: input.userId, role: 'owner' },
  });
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly memberships: MembershipLookup,
  ) {}

  /** Self-service signup: a new owner account with a new business and its default branch. */
  async register(input: RegisterRequest, meta: ClientMeta): Promise<IssuedSession> {
    const passwordHash = await hashPassword(input.password);
    const userId = randomUUID();
    const tenantId = randomUUID();
    try {
      await withDbContext(this.prisma.client, { tenantId, userId }, async (tx) => {
        await tx.user.create({
          data: { id: userId, name: input.name, email: input.email, passwordHash },
        });
        await createTenantWithOwner(tx, { tenantId, userId, businessName: input.businessName });
        await tx.user.update({ where: { id: userId }, data: { lastTenantId: tenantId } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
    return this.startSession(userId, tenantId, meta);
  }

  /**
   * Email (owners, managers) or phone (cashiers) plus password. Unknown users,
   * wrong passwords and disabled accounts all get the same response and take the
   * same time, so the endpoint does not reveal which accounts exist.
   */
  async login(input: LoginRequest, meta: ClientMeta): Promise<IssuedSession> {
    const where = input.identifier.includes('@')
      ? { email: input.identifier.trim().toLowerCase() }
      : (() => {
          const phone = normalizeBdPhone(input.identifier);
          return phone ? { phone } : null;
        })();
    const user = where ? await this.prisma.client.user.findUnique({ where }) : null;
    const passwordOk = await verifyPassword(
      input.password,
      user?.passwordHash ?? (await getDummyPasswordHash()),
    );
    if (!user || !passwordOk || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }

    const shops = await withDbContext(
      this.prisma.client,
      { tenantId: null, userId: user.id },
      (tx) =>
        tx.membership.findMany({
          where: { userId: user.id, tenant: { status: 'active' } },
          select: { tenantId: true },
          orderBy: { createdAt: 'asc' },
        }),
    );
    const tenantId =
      shops.find((m) => m.tenantId === user.lastTenantId)?.tenantId ?? shops[0]?.tenantId;
    if (!tenantId) {
      throw new ApiHttpException(
        403,
        'FORBIDDEN',
        'This account is not a member of any active shop',
      );
    }
    if (tenantId !== user.lastTenantId) {
      await this.prisma.client.user.update({
        where: { id: user.id },
        data: { lastTenantId: tenantId },
      });
    }
    return this.startSession(user.id, tenantId, meta);
  }

  /** Rotates the refresh token. A reused token revokes its whole session. */
  async refresh(presented: string | undefined, meta: ClientMeta): Promise<IssuedSession> {
    if (!presented) {
      throw new UnauthorizedException('No session');
    }
    const result = await this.refreshTokens.rotate(presented, meta);
    if (result.status === 'reused') {
      this.logger.warn(
        { userId: result.userId, familyId: result.familyId },
        'Refresh token reuse detected; session revoked',
      );
    }
    if (result.status !== 'rotated') {
      throw new UnauthorizedException('Session expired');
    }

    const { userId, tenantId, familyId } = result.record;
    const membership = await this.memberships.find(userId, tenantId);
    if (membership?.userStatus !== 'active' || membership.tenantStatus !== 'active') {
      await this.refreshTokens.revokeSession(result.token);
      throw new UnauthorizedException('Session is no longer valid');
    }
    return this.sessionFor(userId, tenantId, familyId, result.token);
  }

  async logout(presented: string | undefined): Promise<void> {
    if (presented) {
      await this.refreshTokens.revokeSession(presented);
    }
  }

  /** Moves the current session to another shop the user belongs to. */
  async switchTenant(
    auth: AuthContext,
    presented: string | undefined,
    targetTenantId: string,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    if (!presented) {
      throw new UnauthorizedException('No session');
    }
    const membership = await this.memberships.find(auth.userId, targetTenantId);
    if (membership?.tenantStatus !== 'active') {
      throw new ApiHttpException(403, 'FORBIDDEN', 'You are not a member of that shop');
    }
    const result = await this.refreshTokens.rotate(presented, meta, {
      tenantId: targetTenantId,
      expectedUserId: auth.userId,
    });
    if (result.status !== 'rotated') {
      throw new UnauthorizedException('Session expired');
    }
    await this.prisma.client.user.update({
      where: { id: auth.userId },
      data: { lastTenantId: targetTenantId },
    });
    return this.sessionFor(auth.userId, targetTenantId, result.record.familyId, result.token);
  }

  /**
   * Replaces the password (and clears a temporary-password flag). Every existing
   * session of the user is revoked; the caller gets a fresh one.
   */
  async changePassword(
    auth: AuthContext,
    input: ChangePasswordRequest,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const user = await this.prisma.client.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new RequestValidationException([
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }
    await this.prisma.client.user.update({
      where: { id: auth.userId },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    await this.refreshTokens.revokeAllForUser(auth.userId);
    return this.startSession(auth.userId, auth.tenantId, meta);
  }

  async session(userId: string, tenantId: string): Promise<Session> {
    return withDbContext(this.prisma.client, { tenantId, userId }, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, name: true, email: true, phone: true, mustChangePassword: true },
      });
      // The self-read policy makes the user's memberships in every shop visible.
      const memberships = await tx.membership.findMany({
        where: { userId, tenant: { status: 'active' } },
        select: { tenantId: true, role: true, tenant: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const current = memberships.find((m) => m.tenantId === tenantId);
      if (!current) {
        throw new UnauthorizedException('Session is no longer valid');
      }
      return {
        user,
        tenant: { id: tenantId, name: current.tenant.name },
        role: current.role,
        permissions: [...permissionsFor(current.role)],
        memberships: memberships.map((m) => ({
          tenantId: m.tenantId,
          tenantName: m.tenant.name,
          role: m.role,
        })),
      };
    });
  }

  private async startSession(
    userId: string,
    tenantId: string,
    meta: ClientMeta,
  ): Promise<IssuedSession> {
    const issued = await this.refreshTokens.issue(userId, tenantId, meta);
    return this.sessionFor(userId, tenantId, issued.record.familyId, issued.token);
  }

  private async sessionFor(
    userId: string,
    tenantId: string,
    sessionId: string,
    refreshToken: string,
  ): Promise<IssuedSession> {
    const accessToken = await this.accessTokens.sign({ userId, tenantId, sessionId });
    return {
      body: {
        accessToken,
        expiresIn: this.accessTokens.ttlSeconds,
        session: await this.session(userId, tenantId),
      },
      refreshToken,
    };
  }
}

import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { loadAccess, publicAccess, type UserAccess } from '../authz/access.js';
import { AppError } from '../common/http-exception.filter.js';
import { invalid, notFound } from '../common/prisma-errors.js';
import { parseInput } from '../common/validation.js';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ChangePasswordInput, LoginInput, RefreshInput, TemporaryPasswordInput, type Client } from './auth.schemas.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

type Tx = Prisma.TransactionClient;

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

export interface TokenPair {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface Session extends TokenPair {
  user: UserAccess;
}

type RevokeReason = 'ROTATED' | 'LOGOUT' | 'LOGOUT_ALL' | 'REUSE_DETECTED' | 'PASSWORD_CHANGED' | 'USER_DEACTIVATED' | 'PASSWORD_RESET';

const sessionInvalid = () => new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.');

/**
 * Sign-in, refresh-token rotation and sign-out.
 *
 * - Passwords: Argon2id; a failed sign-in never reveals whether the e-mail
 *   exists; repeated failures lock the account for a while.
 * - Refresh tokens are single-use: each refresh revokes the presented token
 *   and issues a new one in the same family. Presenting an already-rotated
 *   token again after a short grace period (AUTH_REFRESH_REUSE_GRACE_SECONDS,
 *   for parallel requests from one client) is treated as theft: the whole
 *   family is revoked.
 * - Passwords and tokens are never logged.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  /** Verified against when the e-mail is unknown, so both cases take the same time. */
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly config: AppConfig,
  ) {}

  async login(input: unknown, meta: RequestMeta): Promise<Session> {
    const { email, password, client } = parseInput(LoginInput, input);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const failed = new AppError(
      HttpStatus.UNAUTHORIZED,
      'INVALID_CREDENTIALS',
      `Incorrect email or password. After ${this.config.auth.maxFailedLogins} failed attempts the account is locked for ${this.config.auth.lockoutMinutes} minutes.`,
    );

    if (!user || !user.passwordHash) {
      await this.passwords.verify(await this.getDummyHash(), password);
      throw failed;
    }
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      // Same answer as a wrong password: a locked account is not confirmed to exist.
      await this.passwords.verify(await this.getDummyHash(), password);
      throw failed;
    }
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.recordFailure(user.id);
      throw failed;
    }
    // The password was right: from here on it is safe to say why access is refused.
    if (!user.isActive) throw new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_INACTIVE', 'Your account is inactive. Contact an administrator.');

    const rehash = this.passwords.needsRehash(user.passwordHash) ? await this.passwords.hash(password) : undefined;
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, ...(rehash ? { passwordHash: rehash } : {}) },
      });
      return this.startSession(tx, user.id, randomUUID(), client, meta);
    });
    return this.withoutId(session);
  }

  /** Exchanges a refresh token for a new pair (rotation). */
  async refresh(input: unknown, meta: RequestMeta): Promise<Session> {
    const { refreshToken } = parseInput(RefreshInput, input);
    const claims = await this.tokens.verifyRefreshToken(refreshToken);
    if (!claims) throw sessionInvalid();

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Lock the row: two refreshes with the same token are serialised; the second sees it rotated.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM refresh_tokens WHERE id = ${claims.jti} FOR UPDATE`;
      const row = rows.length ? await tx.refreshToken.findUnique({ where: { id: claims.jti } }) : null;
      if (!row || row.userId !== claims.sub || row.familyId !== claims.fam) return { error: sessionInvalid() };
      if (row.revokedAt) {
        const graceMs = this.config.auth.refreshReuseGraceSeconds * 1000;
        const familyAlive = row.revokedReason === 'ROTATED' && (await tx.refreshToken.count({ where: { familyId: row.familyId, revokedAt: null } })) > 0;
        if (familyAlive && Date.now() - row.revokedAt.getTime() < graceMs) {
          // Parallel refreshes from one client (several browser requests, a retried mobile call):
          // within the grace period, and only while the session has not been ended, the client gets
          // another token in the same session family.
          const user = await tx.user.findUnique({ where: { id: row.userId }, select: { isActive: true } });
          if (!user?.isActive) return { error: new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_INACTIVE', 'Your account is inactive. Contact an administrator.') };
          return { session: await this.startSession(tx, row.userId, row.familyId, row.client as Client, meta) };
        }
        if (row.revokedReason === 'ROTATED') {
          // A token that was already exchanged is being used again: assume it was copied.
          const revoked = await this.revokeWhere(tx, { familyId: row.familyId }, 'REUSE_DETECTED');
          this.logger.warn({ userId: row.userId, familyId: row.familyId, revoked }, 'Refresh token reuse detected; session family revoked');
          return { error: new AppError(HttpStatus.UNAUTHORIZED, 'TOKEN_REUSED', 'This session was ended for your security. Sign in again.') };
        }
        return { error: new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_ENDED', 'Your session has ended. Sign in again.') };
      }
      if (row.expiresAt <= new Date()) return { error: sessionInvalid() };

      const user = await tx.user.findUnique({ where: { id: row.userId }, select: { isActive: true } });
      if (!user?.isActive) {
        await this.revokeWhere(tx, { familyId: row.familyId }, 'USER_DEACTIVATED');
        return { error: new AppError(HttpStatus.FORBIDDEN, 'ACCOUNT_INACTIVE', 'Your account is inactive. Contact an administrator.') };
      }

      const session = await this.startSession(tx, row.userId, row.familyId, row.client as Client, meta);
      await tx.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: new Date(), revokedReason: 'ROTATED', replacedById: session.refreshTokenId },
      });
      return { session };
    });
    // Errors are thrown after the transaction so a family revocation is committed.
    if ('error' in outcome) throw outcome.error;
    return this.withoutId(outcome.session);
  }

  /** Ends the session the refresh token belongs to (its whole family). Idempotent. */
  async logout(input: unknown): Promise<void> {
    const { refreshToken } = parseInput(RefreshInput, input);
    const claims = await this.tokens.verifyRefreshToken(refreshToken);
    if (!claims) return;
    await this.prisma.$transaction((tx) => this.revokeWhere(tx, { familyId: claims.fam, userId: claims.sub }, 'LOGOUT'));
  }

  /** Ends every session of the user, including access tokens already issued. */
  async logoutAll(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.endAllSessions(tx, userId, 'LOGOUT_ALL');
    });
  }

  /** The caller's access, with the names of the regions in their scope (for display). */
  async me(userId: string): Promise<UserAccess & { regions: { id: string; code: string; name: string }[] }> {
    const access = await loadAccess(this.prisma, userId);
    if (!access) throw notFound('User');
    const regions = await this.prisma.region.findMany({ where: { id: { in: access.regionIds } }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } });
    return { ...publicAccess(access), regions };
  }

  /** The user replaces their password; all other sessions end and this client gets a new one. */
  async changePassword(userId: string, input: unknown, meta: RequestMeta): Promise<Session> {
    const data = parseInput(ChangePasswordInput, input);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) throw notFound('User');
    if (!(await this.passwords.verify(user.passwordHash, data.currentPassword))) {
      throw invalid('WRONG_PASSWORD', 'The current password is not correct.', [{ path: 'currentPassword', message: 'not correct' }]);
    }
    this.checkNotEmail(data.newPassword, user.email, 'newPassword');
    const hash = await this.passwords.hash(data.newPassword);
    const session = await this.prisma.$transaction(async (tx) => {
      await this.endAllSessions(tx, userId, 'PASSWORD_CHANGED');
      await tx.user.update({ where: { id: userId }, data: { passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date() } });
      return this.startSession(tx, userId, randomUUID(), data.client, meta);
    });
    return this.withoutId(session);
  }

  /**
   * An administrator gives a user a temporary password (new account or
   * forgotten password). The user must replace it at the next sign-in; any
   * existing sessions end and a lockout is cleared.
   */
  async setTemporaryPassword(userId: string, input: unknown, actorId: string): Promise<void> {
    const { temporaryPassword } = parseInput(TemporaryPasswordInput, input);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw notFound('User');
    this.checkNotEmail(temporaryPassword, user.email, 'temporaryPassword');
    const hash = await this.passwords.hash(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await this.endAllSessions(tx, userId, 'PASSWORD_RESET');
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hash, mustChangePassword: true, passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null, updatedById: actorId },
      });
    });
  }

  /** Clears a sign-in lockout. */
  async unlock(userId: string, actorId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw notFound('User');
    await this.prisma.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null, updatedById: actorId } });
  }

  /** Deletes refresh-token rows that expired more than `olderThanDays` ago (housekeeping). */
  async purgeExpired(olderThanDays = 30): Promise<number> {
    const before = new Date(Date.now() - olderThanDays * 86_400_000);
    return (await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: before } } })).count;
  }

  /** Revokes all of a user's refresh tokens and invalidates access tokens already issued. */
  async endAllSessions(tx: Tx, userId: string, reason: RevokeReason): Promise<void> {
    await this.revokeWhere(tx, { userId }, reason);
    await tx.user.update({ where: { id: userId }, data: { sessionsValidAfter: new Date() } });
  }

  // --- Helpers -------------------------------------------------------------------

  private async startSession(tx: Tx, userId: string, familyId: string, client: Client, meta: RequestMeta) {
    const id = randomUUID();
    const now = Date.now();
    const refreshExpires = new Date(now + this.config.jwt.refreshTtlSeconds * 1000);
    await tx.refreshToken.create({
      data: {
        id,
        userId,
        familyId,
        client,
        userAgent: meta.userAgent?.slice(0, 255) || null,
        ipAddress: meta.ip?.slice(0, 45) || null,
        expiresAt: refreshExpires,
      },
    });
    const access = await loadAccess(tx, userId);
    if (!access) throw notFound('User');
    return {
      refreshTokenId: id,
      tokenType: 'Bearer' as const,
      accessToken: await this.tokens.signAccessToken(userId),
      accessTokenExpiresAt: new Date(now + this.config.jwt.accessTtlSeconds * 1000).toISOString(),
      refreshToken: await this.tokens.signRefreshToken(userId, id, familyId),
      refreshTokenExpiresAt: refreshExpires.toISOString(),
      user: publicAccess(access),
    };
  }

  private withoutId<T extends { refreshTokenId: string }>(s: T): Omit<T, 'refreshTokenId'> {
    const { refreshTokenId: _id, ...rest } = s;
    return rest;
  }

  private async revokeWhere(tx: Tx, where: Prisma.RefreshTokenWhereInput, reason: RevokeReason): Promise<number> {
    const { count } = await tx.refreshToken.updateMany({ where: { ...where, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
    return count;
  }

  /** Counts a failed sign-in; at the limit the account locks and the counter restarts. */
  private async recordFailure(userId: string): Promise<void> {
    const { failedLoginCount } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (failedLoginCount >= this.config.auth.maxFailedLogins) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + this.config.auth.lockoutMinutes * 60_000) },
      });
      this.logger.warn({ userId }, 'Account locked after repeated failed sign-ins');
    }
  }

  private checkNotEmail(password: string, email: string, path: string) {
    if (password.toLowerCase() === email.toLowerCase()) {
      throw invalid('VALIDATION_FAILED', 'The request contains invalid values.', [{ path, message: 'must not be your e-mail address' }]);
    }
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash(randomUUID());
    return this.dummyHash;
  }
}

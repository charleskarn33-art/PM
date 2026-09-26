import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { loadAccess } from '../authz/access.js';
import { ALLOW_PENDING_PASSWORD_CHANGE, ANY_SIGNED_IN, REQUIRED_PERMISSIONS } from '../authz/decorators.js';
import { AppError } from '../common/http-exception.filter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import { IS_PUBLIC } from './public.decorator.js';
import { TokenService } from './token.service.js';

const unauthorized = (code: string, message: string) => new AppError(HttpStatus.UNAUTHORIZED, code, message);
const forbidden = (code: string, message: string) => new AppError(HttpStatus.FORBIDDEN, code, message);

/**
 * Global guard, deny by default:
 * 1. @Public() routes pass.
 * 2. Otherwise a valid access token (`Authorization: Bearer …`) is required.
 * 3. The user is loaded from the database on every request: inactive users,
 *    tokens issued before a sign-out-everywhere / password change, and users
 *    who must replace a temporary password are refused.
 * 4. The route's declared permissions (@RequirePermissions) must all be held;
 *    a route that declares nothing (neither permissions nor @SignedIn) is refused.
 * Organisational scope (which records) is applied by the services.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw unauthorized('UNAUTHORIZED', 'Sign in required.');
    const claims = await this.tokens.verifyAccessToken(token);
    if (!claims) throw unauthorized('INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.');

    const access = await loadAccess(this.prisma, claims.sub);
    if (!access) throw unauthorized('INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.');
    if (access.sessionsValidAfter && claims.ims < access.sessionsValidAfter.getTime()) {
      throw unauthorized('SESSION_ENDED', 'Your session has ended. Sign in again.');
    }
    if (!access.isActive) throw forbidden('ACCOUNT_INACTIVE', 'Your account is inactive. Contact an administrator.');
    const { sessionsValidAfter: _omit, ...user } = access;
    req.user = user;

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, targets)) {
      throw forbidden('PASSWORD_CHANGE_REQUIRED', 'Set a new password before continuing.');
    }

    const required = this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (required) {
      const held = new Set(user.permissions);
      if (!required.every((p) => held.has(p))) throw forbidden('FORBIDDEN', 'You do not have permission to do this.');
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(ANY_SIGNED_IN, targets)) return true;
    // No declaration: refuse rather than guess.
    throw forbidden('FORBIDDEN', 'You do not have permission to do this.');
  }
}

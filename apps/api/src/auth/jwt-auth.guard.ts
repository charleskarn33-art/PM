import { HttpStatus, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../common/http-exception.filter.js';
import type { AuthUser } from './auth-user.js';
import { IS_PUBLIC } from './public.decorator.js';
import { TokenService } from './token.service.js';

/**
 * Global guard: every route needs a valid access token (`Authorization:
 * Bearer …`) unless marked @Public(). Roles, permissions and organisational
 * scope are checked on top of this (Phase 3).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', 'Sign in required.');
    const claims = await this.tokens.verifyAccessToken(token);
    if (!claims) throw new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_TOKEN', 'Your session is invalid or has expired. Sign in again.');
    req.user = { id: claims.sub };
    return true;
  }
}

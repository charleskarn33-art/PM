import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserAccess } from '../authz/access.js';

/**
 * The authenticated caller, attached to the request by JwtAuthGuard after
 * the access token is verified and the user's current roles, permissions and
 * scope are loaded from the database.
 */
export type AuthUser = UserAccess;

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
});

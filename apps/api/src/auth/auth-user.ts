import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** The authenticated caller, attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
});

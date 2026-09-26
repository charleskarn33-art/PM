import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { AllowPendingPasswordChange, SignedIn } from '../authz/decorators.js';
import { UsersService } from './users.service.js';

/** The signed-in user's own profile (any role). */
@SignedIn()
@Controller('me/profile')
export class MeController {
  constructor(private readonly users: UsersService) {}

  /** Readable while a temporary password must still be replaced (the apps show who is signed in). */
  @AllowPendingPasswordChange()
  @Get()
  get(@CurrentUser() me: AuthUser) {
    return this.users.ownProfile(me.id);
  }

  @Patch()
  update(@CurrentUser() me: AuthUser, @Body() body: unknown) {
    return this.users.updateOwnProfile(me.id, body);
  }
}

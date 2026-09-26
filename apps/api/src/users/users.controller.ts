import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { AuthService } from '../auth/auth.service.js';
import { RequirePermissions } from '../authz/decorators.js';
import { requireGlobal } from '../authz/require-global.js';
import { IdPipe } from '../common/id.pipe.js';
import { paged } from '../common/paged.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @RequirePermissions('users.read')
  @Get()
  async list(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return paged(await this.users.listUsers(query, me));
  }

  @RequirePermissions('users.read')
  @Get(':id')
  get(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.users.getUser(id, me);
  }

  @RequirePermissions('users.read', 'roles.read')
  @Get(':id/access')
  async access(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    await this.users.requireVisible(id, me);
    return this.users.getAccess(id);
  }

  @RequirePermissions('users.manage')
  @Post()
  create(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.users.createUser(body, me.id);
  }

  @RequirePermissions('users.manage')
  @Patch(':id')
  update(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.users.updateUser(id, body, me.id);
  }

  @RequirePermissions('users.manage')
  @Put(':id/roles')
  setRoles(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.users.setRoles(id, body, me.id);
  }

  @RequirePermissions('users.manage')
  @Put(':id/region-scopes')
  setRegionScopes(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.users.setRegionScopes(id, body, me.id);
  }

  @RequirePermissions('users.manage')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.users.setActive(id, true, me.id);
  }

  @RequirePermissions('users.manage')
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.users.setActive(id, false, me.id);
  }

  /** Gives the user a temporary password they must change at the next sign-in. */
  @RequirePermissions('users.manage')
  @Post(':id/temporary-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async temporaryPassword(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser): Promise<void> {
    requireGlobal(me);
    await this.auth.setTemporaryPassword(id, body, me.id);
  }

  @RequirePermissions('users.manage')
  @Post(':id/unlock')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unlock(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser): Promise<void> {
    requireGlobal(me);
    await this.auth.unlock(id, me.id);
  }
}

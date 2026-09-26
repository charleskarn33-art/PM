import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions, SignedIn } from '../authz/decorators.js';
import { requireGlobal } from '../authz/require-global.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Everyone signed in reads them (the phone needs the geofence before starting a PM). */
  @SignedIn()
  @Get()
  all() {
    return this.settings.all();
  }

  @RequirePermissions('settings.manage')
  @Put(':key')
  set(@Param('key') key: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.settings.set(key, body, me.id);
  }
}

import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions } from '../authz/decorators.js';
import { AnalyticsService } from './analytics.service.js';

/** Every figure is scoped to the caller's sites. Months are `YYYY-MM` (default: the last 6; at most 24). */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** `?from&to&by=region|county|technician&regionId&countyId` — PM completion. */
  @RequirePermissions('analytics.read')
  @Get('completion')
  completion(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return this.analytics.completion(query, me);
  }

  /** `?from&to&regionId&countyId&siteId` — DC load, battery and generator readings. */
  @RequirePermissions('analytics.read')
  @Get('power')
  power(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return this.analytics.power(query, me);
  }

  /** `?from&to&regionId&countyId` — failure trends. */
  @RequirePermissions('analytics.read')
  @Get('failures')
  failures(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return this.analytics.failures(query, me);
  }
}

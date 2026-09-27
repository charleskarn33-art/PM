import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions, SignedIn } from '../authz/decorators.js';
import { paged } from '../common/paged.js';
import { InsightsService } from './insights.service.js';

@Controller()
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** KPI summary for the web dashboard (scoped). */
  @RequirePermissions('analytics.read')
  @Get('dashboard')
  dashboard(@CurrentUser() me: AuthUser) {
    return this.insights.dashboard(me);
  }

  /** `?role=TECHNICIAN|REGIONAL_SUPERVISOR&q&regionId` — people with their workload. */
  @RequirePermissions('users.read')
  @Get('people')
  async people(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return paged(await this.insights.people(query, me));
  }

  /** `?q=` — sites, failures, corrective actions and people the caller may see. */
  @SignedIn()
  @Get('search')
  search(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return this.insights.search(query, me);
  }
}

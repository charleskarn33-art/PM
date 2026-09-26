import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions } from '../authz/decorators.js';
import { IdPipe } from '../common/id.pipe.js';
import { OrganisationService } from '../organisation/organisation.service.js';
import { AssignmentsService } from './assignments.service.js';

/**
 * Site assignments. Supervisors assign and end technician assignments on
 * sites in their regions; site supervisors are appointed by administrators.
 */
@Controller()
export class AssignmentsController {
  constructor(
    private readonly assignments: AssignmentsService,
    private readonly org: OrganisationService,
  ) {}

  /** Assignment history of a site the caller may see, newest first. */
  @RequirePermissions('assignments.read')
  @Get('sites/:id/assignments')
  async history(@Param('id', IdPipe) siteId: string, @CurrentUser() me: AuthUser) {
    await this.org.getSite(siteId, me);
    return this.assignments.history(siteId);
  }

  /** The caller's own active assignments (e.g. a technician's sites). */
  @RequirePermissions('sites.read')
  @Get('me/assignments')
  mine(@CurrentUser() me: AuthUser) {
    return this.assignments.active({ userId: me.id });
  }

  @RequirePermissions('assignments.manage')
  @Post('assignments')
  assign(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.assignments.assign(body, me.id, me);
  }

  @RequirePermissions('assignments.manage')
  @Post('assignments/:id/end')
  @HttpCode(HttpStatus.OK)
  end(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.assignments.end(id, body, me.id, me);
  }
}

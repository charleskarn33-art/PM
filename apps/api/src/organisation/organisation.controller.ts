import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions } from '../authz/decorators.js';
import { requireGlobal } from '../authz/require-global.js';
import { IdPipe } from '../common/id.pipe.js';
import { paged } from '../common/paged.js';
import { OrganisationService } from './organisation.service.js';

/** Regions → clusters → counties. Reading is limited to the caller's scope. */
@Controller()
export class OrganisationController {
  constructor(private readonly org: OrganisationService) {}

  @RequirePermissions('org.read')
  @Get('org/hierarchy')
  hierarchy(@CurrentUser() me: AuthUser) {
    return this.org.listHierarchy(me);
  }

  @RequirePermissions('org.manage')
  @Post('regions')
  createRegion(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.createRegion(body, me.id);
  }

  @RequirePermissions('org.manage')
  @Patch('regions/:id')
  updateRegion(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.updateRegion(id, body, me.id);
  }

  @RequirePermissions('org.manage')
  @Post('clusters')
  createCluster(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.createCluster(body, me.id);
  }

  @RequirePermissions('org.manage')
  @Patch('clusters/:id')
  updateCluster(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.updateCluster(id, body, me.id);
  }

  @RequirePermissions('org.manage')
  @Post('counties')
  createCounty(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.createCounty(body, me.id);
  }

  @RequirePermissions('org.manage')
  @Patch('counties/:id')
  updateCounty(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.updateCounty(id, body, me.id);
  }
}

/** Sites. Technicians see the sites they are assigned to; managers and supervisors the sites in their regions. */
@Controller('sites')
export class SitesController {
  constructor(private readonly org: OrganisationService) {}

  @RequirePermissions('sites.read')
  @Get()
  async list(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return paged(await this.org.listSites(query, me));
  }

  @RequirePermissions('sites.read')
  @Get(':id')
  get(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.org.getSite(id, me);
  }

  @RequirePermissions('sites.manage')
  @Post()
  create(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.createSite(body, me.id);
  }

  @RequirePermissions('sites.manage')
  @Patch(':id')
  update(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.org.updateSite(id, body, me.id);
  }
}

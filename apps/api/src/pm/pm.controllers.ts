import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions } from '../authz/decorators.js';
import { requireGlobal } from '../authz/require-global.js';
import { IdPipe } from '../common/id.pipe.js';
import { paged } from '../common/paged.js';
import { SchedulesService } from './schedules.service.js';
import { TemplatesService } from './templates.service.js';
import { VisitsService, type UploadedFile as Upload } from './visits.service.js';

/** PM templates, their versions and structure. Changing templates affects every region: administrators only. */
@Controller()
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @RequirePermissions('pm_templates.read')
  @Get('pm-templates')
  list() {
    return this.templates.list();
  }

  @RequirePermissions('pm_templates.read')
  @Get('pm-templates/:id')
  get(@Param('id', IdPipe) id: string) {
    return this.templates.get(id);
  }

  @RequirePermissions('pm_templates.manage')
  @Post('pm-templates')
  create(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.create(body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Patch('pm-templates/:id')
  update(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.update(id, body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Delete('pm-templates/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser): Promise<void> {
    requireGlobal(me);
    await this.templates.deleteDraft(id);
  }

  @RequirePermissions('pm_templates.manage')
  @Post('pm-templates/:id/new-version')
  newVersion(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.newVersion(id, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Post('pm-templates/:id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.activate(id, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Post('pm-templates/:id/sections')
  addSection(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.addSection(id, body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Patch('pm-sections/:id')
  updateSection(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.updateSection(id, body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Delete('pm-sections/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSection(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser): Promise<void> {
    requireGlobal(me);
    await this.templates.deleteSection(id);
  }

  @RequirePermissions('pm_templates.manage')
  @Post('pm-sections/:id/items')
  addItem(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.addItem(id, body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Patch('pm-items/:id')
  updateItem(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.updateItem(id, body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Delete('pm-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteItem(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser): Promise<void> {
    requireGlobal(me);
    await this.templates.deleteItem(id);
  }

  @RequirePermissions('pm_templates.manage')
  @Post('pm-sections/:id/reading-fields')
  addReadingField(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.addReadingField(id, body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Patch('pm-reading-fields/:id')
  updateReadingField(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.updateReadingField(id, body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Delete('pm-reading-fields/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReadingField(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser): Promise<void> {
    requireGlobal(me);
    await this.templates.deleteReadingField(id);
  }

  @RequirePermissions('pm_templates.read')
  @Get('pm-consistency-rules')
  rules() {
    return this.templates.listRules();
  }

  @RequirePermissions('pm_templates.manage')
  @Post('pm-consistency-rules')
  addRule(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.addRule(body, me.id);
  }

  @RequirePermissions('pm_templates.manage')
  @Patch('pm-consistency-rules/:id')
  updateRule(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    requireGlobal(me);
    return this.templates.updateRule(id, body, me.id);
  }
}

/** PM schedules. Supervisors plan PMs for sites in their regions. */
@Controller('pm-schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @RequirePermissions('pm_schedules.read')
  @Get()
  async list(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return paged(await this.schedules.list(query, me));
  }

  @RequirePermissions('pm_schedules.read')
  @Get(':id')
  get(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.schedules.get(id, me);
  }

  @RequirePermissions('pm_schedules.manage')
  @Post()
  create(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.schedules.create(body, me);
  }

  @RequirePermissions('pm_schedules.manage')
  @Patch(':id')
  update(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.schedules.update(id, body, me);
  }

  @RequirePermissions('pm_schedules.manage')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.schedules.cancel(id, body, me);
  }
}

/** PM visits: carried out by the assigned technician, reviewed by a supervisor. */
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @RequirePermissions('pm_visits.read')
  @Get()
  async list(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return paged(await this.visits.list(query, me));
  }

  @RequirePermissions('pm_visits.read')
  @Get(':id')
  get(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.visits.get(id, me);
  }

  @RequirePermissions('pm_visits.perform')
  @Post()
  start(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.visits.start(body, me);
  }

  @RequirePermissions('pm_visits.perform')
  @Put(':id/answers')
  saveAnswers(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.visits.saveAnswers(id, body, me);
  }

  @RequirePermissions('pm_visits.perform')
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.visits.complete(id, me);
  }

  @RequirePermissions('pm_visits.review')
  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  review(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.visits.review(id, body, me);
  }

  /** multipart/form-data: `file` (JPEG, PNG or WebP) and optional `id`, `checklistItemId`, `caption`, `takenAt`. */
  @RequirePermissions('pm_visits.perform')
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file'))
  addPhoto(@Param('id', IdPipe) id: string, @UploadedFile() file: Upload | undefined, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.visits.addPhoto(id, file, body, me);
  }

  @RequirePermissions('pm_visits.read')
  @Get(':id/photos/:photoId')
  async photo(@Param('id', IdPipe) id: string, @Param('photoId', IdPipe) photoId: string, @CurrentUser() me: AuthUser, @Res({ passthrough: true }) res: Response) {
    const { data, contentType } = await this.visits.photoFile(id, photoId, me);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return new StreamableFile(data, { type: contentType, length: data.length });
  }

  @RequirePermissions('pm_visits.perform')
  @Delete(':id/photos/:photoId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePhoto(@Param('id', IdPipe) id: string, @Param('photoId', IdPipe) photoId: string, @CurrentUser() me: AuthUser): Promise<void> {
    await this.visits.deletePhoto(id, photoId, me);
  }
}

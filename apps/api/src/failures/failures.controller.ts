import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions } from '../authz/decorators.js';
import { IdPipe } from '../common/id.pipe.js';
import { paged } from '../common/paged.js';
import { FailuresService, type UploadedFile as Upload } from './failures.service.js';

/** RFC 6266 filename for downloads (ASCII fallback plus UTF-8). */
function disposition(kind: 'inline' | 'attachment', name: string) {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Failures: from completed PMs (automatic) or reported on site. */
@Controller('failures')
export class FailuresController {
  constructor(private readonly failures: FailuresService) {}

  @RequirePermissions('failures.read')
  @Get()
  async list(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return paged(await this.failures.list(query, me));
  }

  @RequirePermissions('failures.read')
  @Get(':id')
  get(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.failures.get(id, me);
  }

  @RequirePermissions('failures.report')
  @Post()
  report(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.report(body, me);
  }

  @RequirePermissions('failures.manage')
  @Patch(':id')
  update(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.update(id, body, me);
  }

  /** `{ note }` — only when no corrective action is still open. */
  @RequirePermissions('failures.manage')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.close(id, body, me);
  }

  @RequirePermissions('failures.manage')
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.reopen(id, body, me);
  }

  /** `{ body, correctiveActionId? }` */
  @RequirePermissions('failures.read')
  @Post(':id/comments')
  comment(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.comment(id, body, me);
  }

  /** multipart/form-data: `file` (JPEG / PNG / WebP photo or PDF) and optional `id`, `correctiveActionId`, `caption`. */
  @RequirePermissions('failures.read')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  addAttachment(@Param('id', IdPipe) id: string, @UploadedFile() file: Upload | undefined, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.addAttachment(id, file, body, me);
  }

  @RequirePermissions('failures.read')
  @Get(':id/attachments/:attachmentId')
  async attachment(@Param('id', IdPipe) id: string, @Param('attachmentId', IdPipe) attachmentId: string, @CurrentUser() me: AuthUser, @Res({ passthrough: true }) res: Response) {
    const file = await this.failures.attachmentFile(id, attachmentId, me);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    // Documents are downloaded, never rendered by the browser in the API's origin.
    res.setHeader('Content-Disposition', disposition(file.kind === 'PHOTO' ? 'inline' : 'attachment', file.fileName));
    return new StreamableFile(file.data, { type: file.contentType, length: file.data.length });
  }

  @RequirePermissions('failures.read')
  @Delete(':id/attachments/:attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAttachment(@Param('id', IdPipe) id: string, @Param('attachmentId', IdPipe) attachmentId: string, @CurrentUser() me: AuthUser) {
    await this.failures.deleteAttachment(id, attachmentId, me);
  }
}

/** Corrective actions: assign → start → complete → verify → close. */
@Controller('corrective-actions')
export class CorrectiveActionsController {
  constructor(private readonly failures: FailuresService) {}

  @RequirePermissions('corrective_actions.read')
  @Get()
  async list(@Query() query: unknown, @CurrentUser() me: AuthUser) {
    return paged(await this.failures.listActions(query, me));
  }

  @RequirePermissions('corrective_actions.read')
  @Get(':id')
  get(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.failures.getAction(id, me);
  }

  @RequirePermissions('corrective_actions.manage')
  @Post()
  create(@Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.createAction(body, me);
  }

  @RequirePermissions('corrective_actions.manage')
  @Patch(':id')
  update(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.updateAction(id, body, me);
  }

  /** `{ assignedToId, dueDate? }` */
  @RequirePermissions('corrective_actions.manage')
  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  assign(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.assign(id, body, me);
  }

  @RequirePermissions('corrective_actions.work')
  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  start(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser) {
    return this.failures.start(id, me);
  }

  /** `{ note }` — what was done. */
  @RequirePermissions('corrective_actions.work')
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.complete(id, body, me);
  }

  /** `{ decision: APPROVE | REJECT, note? }` (note required to send it back). */
  @RequirePermissions('corrective_actions.manage')
  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  verify(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.verify(id, body, me);
  }

  /** `{ note? }` — closes a verified action; withdrawing one not started needs a note. */
  @RequirePermissions('corrective_actions.manage')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    return this.failures.closeAction(id, body, me);
  }

  /** `{ body }` — on the failure's timeline, marked with this action. */
  @RequirePermissions('corrective_actions.read')
  @Post(':id/comments')
  async comment(@Param('id', IdPipe) id: string, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    const failureId = await this.failures.actionFailureId(id, me);
    return this.failures.comment(failureId, { ...(body && typeof body === 'object' ? body : {}), correctiveActionId: id }, me);
  }

  /** multipart/form-data: `file`, optional `id`, `caption`. */
  @RequirePermissions('corrective_actions.read')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  async addAttachment(@Param('id', IdPipe) id: string, @UploadedFile() file: Upload | undefined, @Body() body: unknown, @CurrentUser() me: AuthUser) {
    const failureId = await this.failures.actionFailureId(id, me);
    return this.failures.addAttachment(failureId, file, { ...(body && typeof body === 'object' ? body : {}), correctiveActionId: id }, me);
  }
}

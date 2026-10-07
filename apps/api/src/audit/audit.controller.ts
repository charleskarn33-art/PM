import { Readable } from 'node:stream';
import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../authz/decorators.js';
import { WithMeta } from '../common/envelope.js';
import { IdPipe } from '../common/id.pipe.js';
import { ACTION_LABELS } from './audit-actions.js';
import { AuditService } from './audit.service.js';

/** The audit log (read-only; nothing can change or remove an entry). */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** `?q&action&entityType&entityId&actorId&outcome&from&to&page&pageSize` — newest first. */
  @RequirePermissions('audit.read')
  @Get()
  async list(@Query() query: unknown) {
    const r = await this.audit.list(query);
    return new WithMeta(r.items, { total: r.total, page: r.page, pageSize: r.pageSize });
  }

  /** The action names and their labels (for filters). */
  @RequirePermissions('audit.read')
  @Get('actions')
  actions() {
    return ACTION_LABELS;
  }

  /** Same filters as the list: every matching entry as CSV. */
  @RequirePermissions('audit.read')
  @Get('export.csv')
  exportCsv(@Query() query: unknown, @Res({ passthrough: true }) res: Response) {
    const { fileName, body } = this.audit.exportCsv(query);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(Readable.from(body), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${fileName}"` });
  }

  /** One entry with the changes and what was sent. */
  @RequirePermissions('audit.read')
  @Get(':id')
  get(@Param('id', IdPipe) id: string) {
    return this.audit.get(id);
  }
}

import { Readable } from 'node:stream';
import { Controller, Get, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/auth-user.js';
import { RequirePermissions } from '../authz/decorators.js';
import { IdPipe } from '../common/id.pipe.js';
import { WithMeta } from '../common/envelope.js';
import { ExportsService } from './exports.service.js';
import { PmHistoryService } from './history.service.js';
import { ReportsService } from './reports.service.js';

@Controller()
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ExportsService,
    private readonly history: PmHistoryService,
  ) {}

  /** The PM visit report (PDF, A4), built from the stored visit. */
  @RequirePermissions('pm_visits.read')
  @Get('visits/:id/report.pdf')
  async visitReport(@Param('id', IdPipe) id: string, @CurrentUser() me: AuthUser, @Res({ passthrough: true }) res: Response) {
    const { pdf, fileName } = await this.reports.visitReport(id, me);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(pdf, { type: 'application/pdf', length: pdf.length, disposition: `inline; filename="${fileName}"` });
  }

  /** `?from&to&page&pageSize` — a site's PM visits, newest first, with results and key readings. */
  @RequirePermissions('pm_visits.read')
  @Get('sites/:id/pm-history')
  async siteHistory(@Param('id', IdPipe) id: string, @Query() query: unknown, @CurrentUser() me: AuthUser) {
    const h = await this.history.history(id, query, me);
    return new WithMeta(h.items, { total: h.total, page: h.page, pageSize: h.pageSize, site: h.site, summary: h.summary });
  }

  /**
   * `GET /exports/<dataset>.csv?filters` — visits, schedules, failures,
   * corrective-actions, sites, readings (`module=generator|dc|battery`).
   */
  @RequirePermissions('reports.export')
  @Get('exports/:file')
  exportCsv(@Param('file') file: string, @Query() query: unknown, @CurrentUser() me: AuthUser, @Res({ passthrough: true }) res: Response) {
    const { fileName, body } = this.exports.export(file.replace(/\.csv$/, ''), query, me);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(Readable.from(body), { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${fileName}"` });
  }
}

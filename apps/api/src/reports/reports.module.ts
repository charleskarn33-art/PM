import { Module } from '@nestjs/common';
import { PmModule } from '../pm/pm.module.js';
import { ExportsService } from './exports.service.js';
import { PmHistoryService } from './history.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({ imports: [PmModule], controllers: [ReportsController], providers: [ReportsService, ExportsService, PmHistoryService] })
export class ReportsModule {}

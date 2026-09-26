import { Module } from '@nestjs/common';
import { OrganisationModule } from '../organisation/organisation.module.js';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '../config/app-config.js';
import { OverdueJob } from './overdue.job.js';
import { FieldService } from './field.service.js';
import { FieldController, SchedulesController, SitePowerController, TemplatesController, VisitsController } from './pm.controllers.js';
import { PowerHistoryService } from './power-history.service.js';
import { SchedulesService } from './schedules.service.js';
import { TemplatesService } from './templates.service.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [
    OrganisationModule,
    // Uploads are held in memory (multer's default without `dest`): one photo, size-limited,
    // checked before anything is stored.
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ limits: { fileSize: config.photoMaxBytes, files: 1, fields: 10, fieldSize: 2_000 } }),
    }),
  ],
  controllers: [TemplatesController, SchedulesController, VisitsController, SitePowerController, FieldController],
  providers: [TemplatesService, SchedulesService, VisitsService, PowerHistoryService, OverdueJob, FieldService],
  exports: [TemplatesService, SchedulesService, VisitsService],
})
export class PmModule {}

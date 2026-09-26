import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '../config/app-config.js';
import { OverdueJob } from './overdue.job.js';
import { SchedulesController, TemplatesController, VisitsController } from './pm.controllers.js';
import { SchedulesService } from './schedules.service.js';
import { TemplatesService } from './templates.service.js';
import { VisitsService } from './visits.service.js';

@Module({
  imports: [
    // Uploads are held in memory (multer's default without `dest`): one photo, size-limited,
    // checked before anything is stored.
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ limits: { fileSize: config.photoMaxBytes, files: 1, fields: 10, fieldSize: 2_000 } }),
    }),
  ],
  controllers: [TemplatesController, SchedulesController, VisitsController],
  providers: [TemplatesService, SchedulesService, VisitsService, OverdueJob],
  exports: [TemplatesService, SchedulesService, VisitsService],
})
export class PmModule {}

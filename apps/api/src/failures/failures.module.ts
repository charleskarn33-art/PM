import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '../config/app-config.js';
import { CorrectiveActionsController, FailuresController } from './failures.controller.js';
import { FailuresService } from './failures.service.js';

@Module({
  imports: [
    // Uploads are held in memory: one file, at most the larger of the photo and document limits,
    // checked by content before anything is stored.
    MulterModule.registerAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({ limits: { fileSize: Math.max(config.photoMaxBytes, config.documentMaxBytes), files: 1, fields: 10, fieldSize: 2_000 } }),
    }),
  ],
  controllers: [FailuresController, CorrectiveActionsController],
  providers: [FailuresService],
  exports: [FailuresService],
})
export class FailuresModule {}

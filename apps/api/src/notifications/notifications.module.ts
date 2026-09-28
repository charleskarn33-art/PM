import { Global, Module } from '@nestjs/common';
import { NotificationJobs } from './notification.jobs.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PushSender } from './push.sender.js';

/** Global: the services that cause notifications (PM, failures, assignments) use it directly. */
@Global()
@Module({ controllers: [NotificationsController], providers: [NotificationsService, PushSender, NotificationJobs], exports: [NotificationsService] })
export class NotificationsModule {}

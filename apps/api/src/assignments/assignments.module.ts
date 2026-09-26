import { Module } from '@nestjs/common';
import { AssignmentsService } from './assignments.service.js';

@Module({ providers: [AssignmentsService], exports: [AssignmentsService] })
export class AssignmentsModule {}

import { Module } from '@nestjs/common';
import { OrganisationModule } from '../organisation/organisation.module.js';
import { AssignmentsController } from './assignments.controller.js';
import { AssignmentsService } from './assignments.service.js';

@Module({ imports: [OrganisationModule], controllers: [AssignmentsController], providers: [AssignmentsService], exports: [AssignmentsService] })
export class AssignmentsModule {}

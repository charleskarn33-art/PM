import { Module } from '@nestjs/common';
import { OrganisationController, SitesController } from './organisation.controller.js';
import { OrganisationService } from './organisation.service.js';

@Module({ controllers: [OrganisationController, SitesController], providers: [OrganisationService], exports: [OrganisationService] })
export class OrganisationModule {}

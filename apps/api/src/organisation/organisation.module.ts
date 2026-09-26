import { Module } from '@nestjs/common';
import { OrganisationService } from './organisation.service.js';

@Module({ providers: [OrganisationService], exports: [OrganisationService] })
export class OrganisationModule {}

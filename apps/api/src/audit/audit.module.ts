import { Global, Module } from '@nestjs/common';
import { AUDIT_REFUSALS } from '../common/audit-hook.js';
import { AuditRefusals } from './audit-refusals.js';
import { AuditController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';

/** Global: the exception filter and the interceptor (registered by the app module) use it. */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor, AuditRefusals, { provide: AUDIT_REFUSALS, useExisting: AuditRefusals }],
  exports: [AuditService, AuditInterceptor, AUDIT_REFUSALS],
})
export class AuditModule {}

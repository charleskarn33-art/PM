import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuditRefusals as Hook } from '../common/audit-hook.js';
import { AppConfig } from '../config/app-config.js';
import { ROUTES, routeKey } from './audit-actions.js';
import { param, requestMeta, requestSnapshot, routeTemplate, type AuditRequest } from './audit.interceptor.js';
import { AuditService } from './audit.service.js';

/**
 * Refused requests (403, on any route, reads included) and failed or locked
 * sign-ins go in the audit log. Other 401s (an expired session) do not.
 */
@Injectable()
export class AuditRefusals implements Hook {
  constructor(
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  async record(request: Request, status: number, code: string): Promise<void> {
    const req = request as AuditRequest;
    const template = routeTemplate(req);
    if (!template) return;
    const key = routeKey(req.method, template);
    const login = key === 'POST /auth/login';
    if (status !== 403 && !login && key !== 'POST /auth/change-password') return;
    const spec = ROUTES[key];
    const label = spec && 'label' in spec ? spec.label : key;
    const email = login && typeof (req.body as { email?: unknown })?.email === 'string' ? String((req.body as { email: string }).email).trim().toLowerCase().slice(0, 255) : null;
    await this.audit.record({
      actor: req.user ? { id: req.user.id, fullName: req.user.fullName, email: req.user.email } : null,
      action: login ? 'auth.login_failed' : spec && 'action' in spec ? spec.action : key,
      outcome: status === 403 ? 'DENIED' : 'FAILED',
      entityType: login ? 'user' : spec && 'entityType' in spec ? spec.entityType : null,
      entityId: spec && 'idParam' in spec && spec.idParam ? param(req, spec.idParam) : null,
      summary: login ? `Sign-in failed${email ? ` for ${email}` : ''} (${code})` : status === 403 ? `Refused: ${label} (${code})` : `${label} failed (${code})`,
      request: requestSnapshot(req),
      ...requestMeta(req, this.config),
    });
  }
}

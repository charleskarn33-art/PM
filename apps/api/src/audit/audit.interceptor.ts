import { Injectable, StreamableFile, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { defer, mergeMap, switchMap, type Observable } from 'rxjs';
import type { AuthUser } from '../auth/auth-user.js';
import { clientIp } from '../common/client-ip.js';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ROUTES, routeKey, type RouteAudit } from './audit-actions.js';
import { diff, sanitize } from './audit-values.js';
import { AuditService } from './audit.service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type AuditRequest = Request & { user?: AuthUser; id?: string; file?: { originalname?: string; size?: number; mimetype?: string } };

/** A route parameter as text (Express 5 wildcard parameters are arrays). */
export const param = (req: Request, name: string): string | null => {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return v == null ? null : Array.isArray(v) ? v.join('/') : v;
};

/** The route template without the API prefix, e.g. `/visits/:id/review` (null: no route matched). */
export function routeTemplate(req: Request): string | null {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') return null;
  return path.replace(/^\/api\/v\d+(?=\/|$)/, '') || '/';
}

/** How a request is audited: its route's entry, or a generic one for an unlisted change; null: not audited. */
export function auditSpec(req: Request): { key: string; spec: RouteAudit } | null {
  const template = routeTemplate(req);
  if (!template) return null;
  const key = routeKey(req.method, template);
  const spec = ROUTES[key];
  if (spec) return 'skip' in spec ? null : { key, spec };
  // An unlisted change is still recorded (a test keeps the list complete).
  return MUTATING.has(req.method) ? { key, spec: { action: key, label: key, entityType: null } } : null;
}

/** What was sent, without secrets: route parameters, query and body (and an uploaded file's name and size). */
export function requestSnapshot(req: AuditRequest): Prisma.InputJsonValue {
  const out: Record<string, unknown> = {};
  if (req.params && Object.keys(req.params).length) out.params = req.params;
  if (req.query && Object.keys(req.query).length) out.query = req.query;
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) out.body = req.body;
  if (req.file) out.file = { name: req.file.originalname, size: req.file.size, type: req.file.mimetype };
  return sanitize(out) as Prisma.InputJsonValue;
}

export function requestMeta(req: AuditRequest, config: AppConfig) {
  const ua = req.headers['user-agent'];
  return { method: req.method, path: req.originalUrl.split('?')[0]!, ip: clientIp(req, config.webForwardSecret), userAgent: typeof ua === 'string' ? ua : null, requestId: req.id ? String(req.id) : null };
}

/** A few words that make an entry readable at a glance. */
function detail(key: string, req: AuditRequest): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof body.decision === 'string') parts.push(body.decision === 'APPROVE' ? 'approved' : 'returned');
  if (key === 'PUT /settings/:key') parts.push(String(param(req, 'key')));
  if (key === 'GET /exports/:file') parts.push(String(param(req, 'file')));
  if (key === 'POST /users/:id/deactivate' && typeof body.reason === 'string') parts.push(body.reason);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/** The id of a created record (or the signed-in user), from the handler's result. */
function resultId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || value instanceof StreamableFile) return null;
  if (Array.isArray(value)) return resultId(value[0]);
  const v = value as { id?: unknown; user?: { id?: unknown }; data?: unknown };
  if (typeof v.id === 'string') return v.id;
  if (v.user && typeof v.user.id === 'string') return v.user.id;
  return null;
}

/**
 * Records every successful change made through the API (and the reports and
 * exports handed out): who, what, which record, the fields that changed and
 * what was sent. Refused attempts and failed sign-ins are recorded by the
 * exception filter, which also sees errors raised before this runs.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly config: AppConfig,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<AuditRequest>();
    const found = auditSpec(req);
    if (!found) return next.handle();
    const { key, spec } = found;
    const paramId = spec.idParam ? param(req, spec.idParam) : null;
    // Own profile: the record is the caller.
    const snapshotId = spec.model ? (paramId ?? req.user?.id ?? null) : null;
    let before: Record<string, unknown> | null = null;

    return defer(async () => {
      if (spec.model && snapshotId) before = await this.audit.snapshot(spec.model, snapshotId);
    }).pipe(
      switchMap(() => next.handle()),
      mergeMap(async (value) => {
        const after = spec.model && snapshotId ? await this.audit.snapshot(spec.model, snapshotId) : null;
        const loginUser = key === 'POST /auth/login' ? (value as { user?: { id: string; email?: string; fullName?: string } } | null)?.user : undefined;
        const actor = req.user ?? loginUser ?? null;
        await this.audit.record({
          actor: actor ? { id: actor.id, fullName: actor.fullName, email: actor.email } : null,
          action: spec.action,
          entityType: spec.entityType,
          entityId: paramId ?? snapshotId ?? resultId(value) ?? (spec.entityType === 'user' ? (actor?.id ?? null) : null),
          summary: `${spec.label}${detail(key, req)}`,
          changes: spec.model ? (diff(before, after) as Prisma.InputJsonValue | null) : null,
          request: requestSnapshot(req),
          ...requestMeta(req, this.config),
        });
        return value;
      }),
    );
  }
}

/**
 * What each API route means in the audit log. Every route that changes
 * something is listed (a test checks this against the running app): either
 * audited, with a readable action, or skipped with the reason. Reads are not
 * audited, except those that hand data out (reports, exports).
 *
 * `model` + `idParam`: the record whose fields are compared before and after
 * the change (field-level changes in the log).
 */

export type Snapshot =
  | 'region'
  | 'cluster'
  | 'county'
  | 'site'
  | 'user'
  | 'systemSetting'
  | 'pmTemplate'
  | 'pmSection'
  | 'pmChecklistItem'
  | 'pmReadingField'
  | 'pmConsistencyRule'
  | 'pmSchedule'
  | 'pmVisit'
  | 'failure'
  | 'correctiveAction'
  | 'siteAssignment';

export interface RouteAudit {
  action: string;
  label: string;
  entityType: string | null;
  /** The route parameter holding the record's id (else the created record's id, else none). */
  idParam?: string;
  /** Compare this record before and after (field-level changes). */
  model?: Snapshot;
}
export interface RouteSkip {
  skip: string;
}

const a = (action: string, label: string, entityType: string | null, extra: Partial<RouteAudit> = {}): RouteAudit => ({ action, label, entityType, idParam: 'id', ...extra });

export const ROUTES: Record<string, RouteAudit | RouteSkip> = {
  // Sign-in and account
  'POST /auth/login': a('auth.login', 'Signed in', 'user', { idParam: undefined }),
  'POST /auth/refresh': { skip: 'session renewal every few minutes; sign-in and sign-out are recorded' },
  'POST /auth/logout': a('auth.logout', 'Signed out', 'user', { idParam: undefined }),
  'POST /auth/logout-all': a('auth.logout_all', 'Signed out everywhere', 'user', { idParam: undefined }),
  'POST /auth/change-password': a('auth.change_password', 'Changed own password', 'user', { idParam: undefined }),
  'PATCH /me/profile': a('user.update_own_profile', 'Updated own profile', 'user', { idParam: undefined, model: 'user' }),

  // Users
  'POST /users': a('user.create', 'User created', 'user', { idParam: undefined }),
  'PATCH /users/:id': a('user.update', 'User changed', 'user', { model: 'user' }),
  'PUT /users/:id/roles': a('user.set_roles', 'User roles changed', 'user', { model: 'user' }),
  'PUT /users/:id/region-scopes': a('user.set_regions', 'User regions changed', 'user', { model: 'user' }),
  'POST /users/:id/activate': a('user.activate', 'User activated', 'user', { model: 'user' }),
  'POST /users/:id/deactivate': a('user.deactivate', 'User deactivated', 'user', { model: 'user' }),
  'POST /users/:id/temporary-password': a('user.temporary_password', 'Temporary password issued', 'user', { model: 'user' }),
  'POST /users/:id/unlock': a('user.unlock', 'User unlocked', 'user', { model: 'user' }),

  // Organisation
  'POST /regions': a('region.create', 'Region created', 'region', { idParam: undefined }),
  'PATCH /regions/:id': a('region.update', 'Region changed', 'region', { model: 'region' }),
  'POST /clusters': a('cluster.create', 'Cluster created', 'cluster', { idParam: undefined }),
  'PATCH /clusters/:id': a('cluster.update', 'Cluster changed', 'cluster', { model: 'cluster' }),
  'POST /counties': a('county.create', 'County created', 'county', { idParam: undefined }),
  'PATCH /counties/:id': a('county.update', 'County changed', 'county', { model: 'county' }),
  'POST /sites': a('site.create', 'Site created', 'site', { idParam: undefined }),
  'PATCH /sites/:id': a('site.update', 'Site changed', 'site', { model: 'site' }),
  'POST /assignments': a('assignment.create', 'Site assignment made', 'assignment', { idParam: undefined }),
  'POST /assignments/:id/end': a('assignment.end', 'Site assignment ended', 'assignment', { model: 'siteAssignment' }),

  // Settings
  'PUT /settings/:key': a('settings.update', 'Setting changed', 'setting', { idParam: 'key', model: 'systemSetting' }),

  // PM templates
  'POST /pm-templates': a('template.create', 'PM template created', 'template', { idParam: undefined }),
  'PATCH /pm-templates/:id': a('template.update', 'PM template changed', 'template', { model: 'pmTemplate' }),
  'DELETE /pm-templates/:id': a('template.delete', 'PM template draft deleted', 'template', { model: 'pmTemplate' }),
  'POST /pm-templates/:id/new-version': a('template.new_version', 'PM template new version drafted', 'template'),
  'POST /pm-templates/:id/activate': a('template.activate', 'PM template version activated', 'template', { model: 'pmTemplate' }),
  'POST /pm-templates/:id/sections': a('template.section_create', 'PM template section added', 'template'),
  'PATCH /pm-sections/:id': a('template.section_update', 'PM template section changed', 'template_section', { model: 'pmSection' }),
  'DELETE /pm-sections/:id': a('template.section_delete', 'PM template section removed', 'template_section', { model: 'pmSection' }),
  'POST /pm-sections/:id/items': a('template.item_create', 'Checklist question added', 'template_section'),
  'PATCH /pm-items/:id': a('template.item_update', 'Checklist question changed', 'template_item', { model: 'pmChecklistItem' }),
  'DELETE /pm-items/:id': a('template.item_delete', 'Checklist question removed', 'template_item', { model: 'pmChecklistItem' }),
  'POST /pm-sections/:id/reading-fields': a('template.reading_create', 'Reading field added', 'template_section'),
  'PATCH /pm-reading-fields/:id': a('template.reading_update', 'Reading field changed', 'template_reading', { model: 'pmReadingField' }),
  'DELETE /pm-reading-fields/:id': a('template.reading_delete', 'Reading field removed', 'template_reading', { model: 'pmReadingField' }),
  'POST /pm-consistency-rules': a('template.rule_create', 'Consistency rule added', 'rule', { idParam: undefined }),
  'PATCH /pm-consistency-rules/:id': a('template.rule_update', 'Consistency rule changed', 'rule', { model: 'pmConsistencyRule' }),

  // PM schedule and visits
  'POST /pm-schedules': a('schedule.create', 'PM scheduled', 'schedule', { idParam: undefined }),
  'PATCH /pm-schedules/:id': a('schedule.update', 'PM schedule changed', 'schedule', { model: 'pmSchedule' }),
  'POST /pm-schedules/:id/cancel': a('schedule.cancel', 'PM cancelled', 'schedule', { model: 'pmSchedule' }),
  'POST /visits': a('visit.start', 'PM started', 'visit', { idParam: undefined }),
  'PUT /visits/:id/answers': a('visit.save_answers', 'PM answers saved', 'visit'),
  'POST /visits/:id/complete': a('visit.complete', 'PM completed', 'visit', { model: 'pmVisit' }),
  'POST /visits/:id/review': a('visit.review', 'PM reviewed', 'visit', { model: 'pmVisit' }),
  'PUT /visits/:id/signature': a('visit.sign', 'PM signed', 'visit'),
  'PUT /visits/:id/battery-units': a('visit.save_batteries', 'Battery voltages saved', 'visit'),
  'POST /visits/:id/photos': a('visit.photo_add', 'PM photo added', 'visit'),
  'DELETE /visits/:id/photos/:photoId': a('visit.photo_delete', 'PM photo removed', 'visit'),

  // Failures and corrective actions
  'POST /failures': a('failure.report', 'Failure reported', 'failure', { idParam: undefined }),
  'PATCH /failures/:id': a('failure.update', 'Failure changed', 'failure', { model: 'failure' }),
  'POST /failures/:id/close': a('failure.close', 'Failure closed', 'failure', { model: 'failure' }),
  'POST /failures/:id/reopen': a('failure.reopen', 'Failure reopened', 'failure', { model: 'failure' }),
  'POST /failures/:id/comments': a('failure.comment', 'Comment on a failure', 'failure'),
  'POST /failures/:id/attachments': a('failure.attachment_add', 'File added to a failure', 'failure'),
  'DELETE /failures/:id/attachments/:attachmentId': a('failure.attachment_delete', 'File removed from a failure', 'failure'),
  'POST /corrective-actions': a('action.create', 'Corrective action created', 'action', { idParam: undefined }),
  'PATCH /corrective-actions/:id': a('action.update', 'Corrective action changed', 'action', { model: 'correctiveAction' }),
  'POST /corrective-actions/:id/assign': a('action.assign', 'Corrective action assigned', 'action', { model: 'correctiveAction' }),
  'POST /corrective-actions/:id/start': a('action.start', 'Corrective action started', 'action', { model: 'correctiveAction' }),
  'POST /corrective-actions/:id/complete': a('action.complete', 'Corrective action completed', 'action', { model: 'correctiveAction' }),
  'POST /corrective-actions/:id/verify': a('action.verify', 'Corrective action checked', 'action', { model: 'correctiveAction' }),
  'POST /corrective-actions/:id/close': a('action.close', 'Corrective action closed', 'action', { model: 'correctiveAction' }),
  'POST /corrective-actions/:id/comments': a('action.comment', 'Comment on a corrective action', 'action'),
  'POST /corrective-actions/:id/attachments': a('action.attachment_add', 'File added to a corrective action', 'action'),

  // Notifications (personal: not audited)
  'POST /notifications/read-all': { skip: 'marking one’s own notifications read' },
  'POST /notifications/:id/read': { skip: 'marking one’s own notification read' },
  'POST /push-tokens': { skip: 'a phone registering for its user’s notifications' },
  'DELETE /push-tokens': { skip: 'a phone unregistering on sign-out (the sign-out is recorded)' },

  // Data handed out
  'GET /visits/:id/report.pdf': a('report.visit_pdf', 'PM report downloaded', 'visit'),
  'GET /exports/:file': a('export.csv', 'CSV exported', null, { idParam: undefined }),
  'GET /audit/export.csv': a('audit.export', 'Audit log exported', null, { idParam: undefined }),
};

export const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;

/** The readable name of every audited action (for the UI filter). */
export const ACTION_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.values(ROUTES).flatMap((r) => ('action' in r ? [[r.action, r.label]] : []))),
  'auth.login_failed': 'Sign-in failed',
};

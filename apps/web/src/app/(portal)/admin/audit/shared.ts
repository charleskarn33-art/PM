export interface AuditEntry {
  id: string;
  occurredAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
  entityType: string | null;
  entityId: string | null;
  summary: string;
  method: string;
  path: string;
  changes?: Record<string, { from: unknown; to: unknown }> | null;
  request?: unknown;
  ip: string | null;
  userAgent?: string | null;
  requestId: string | null;
}

export const ENTITY_TYPES: [string, string][] = [
  ['site', 'Site'],
  ['user', 'User'],
  ['visit', 'PM visit'],
  ['schedule', 'PM schedule'],
  ['failure', 'Failure'],
  ['action', 'Corrective action'],
  ['assignment', 'Site assignment'],
  ['template', 'PM template'],
  ['template_section', 'Template section'],
  ['template_item', 'Checklist question'],
  ['template_reading', 'Reading field'],
  ['rule', 'Consistency rule'],
  ['region', 'Region'],
  ['cluster', 'Cluster'],
  ['county', 'County'],
  ['setting', 'Setting'],
];
export const ENTITY_LABEL = Object.fromEntries(ENTITY_TYPES);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGES: Record<string, (id: string) => string> = {
  site: (id) => `/sites/${id}`,
  user: (id) => `/admin/users/${id}`,
  visit: (id) => `/visits/${id}`,
  schedule: (id) => `/schedule/${id}`,
  failure: (id) => `/failures/${id}`,
  action: (id) => `/corrective-actions/${id}`,
  template: (id) => `/admin/templates/${id}`,
  region: () => '/admin/organization',
  cluster: () => '/admin/organization',
  county: () => '/admin/organization',
};

/** The page of the record an entry is about (it may no longer exist). */
export function entityHref(type: string | null, id: string | null): string | null {
  if (type === 'setting') return '/admin/settings';
  if (!type || !id || !UUID.test(id) || !PAGES[type]) return null;
  return PAGES[type](id);
}

export const OUTCOME_TONE = { SUCCESS: 'success', DENIED: 'danger', FAILED: 'warning' } as const;
export const OUTCOME_LABEL = { SUCCESS: 'Done', DENIED: 'Refused', FAILED: 'Failed' } as const;

/** A stored value as short readable text. */
export function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

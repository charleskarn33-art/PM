/** Readable summaries of audit log entries (pure; unit-tested). */

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const fmt = (v: Json | undefined): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const col = (k: string) => k.replace(/_id$/, '').replace(/_/g, ' ');

/** One line describing what an entry recorded, from its metadata. */
export function describeAuditEntry(action: string, metadata: Json): string {
  const m = (metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}) as Record<string, Json>;
  if (action === 'REPORT_GENERATED') {
    const rows = m.rows != null ? `, ${fmt(m.rows)} row(s)` : '';
    const name = fmt(m.report)
      .split('_')
      .map((w) => (['pm', 'csv', 'pdf'].includes(w) ? w.toUpperCase() : w))
      .join(' ');
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}${rows}`;
  }
  if (action === 'LOGIN') return m.client ? `Signed in (${fmt(m.client)})` : 'Signed in';
  if (m.changes && typeof m.changes === 'object' && !Array.isArray(m.changes)) {
    return Object.entries(m.changes as Record<string, { from?: Json; to?: Json }>)
      .map(([k, c]) => `${col(k)}: ${fmt(c?.from)} → ${fmt(c?.to)}`)
      .join('; ');
  }
  if (Array.isArray(m.changed)) return `Changed: ${(m.changed as Json[]).map((k) => col(String(k))).join(', ')}`;
  if (m.record && typeof m.record === 'object') {
    return Object.entries(m.record as Record<string, Json>)
      .filter(([k]) => !k.endsWith('_id'))
      .map(([k, v]) => `${col(k)}: ${fmt(v)}`)
      .join('; ');
  }
  if (m.deleted && typeof m.deleted === 'object') {
    const d = m.deleted as Record<string, Json>;
    const label = d.name ?? d.code ?? d.site_code ?? d.failure_number ?? d.action_number ?? d.prompt ?? d.label ?? d.key;
    return label != null ? `Deleted ${fmt(label)}` : 'Deleted';
  }
  // Status transitions (PM review, etc.): from → to, whatever order the keys come in.
  if ('from' in m && 'to' in m) return `${fmt(m.from)} → ${fmt(m.to)}`;
  const rest = Object.entries(m).filter(([k]) => !k.endsWith('_id'));
  return rest.length ? rest.map(([k, v]) => `${col(k)}: ${fmt(v)}`).join('; ') : '';
}

/** Web page for the audited record, where one exists. */
export function auditEntityHref(entityType: string | null, entityId: string | null, action: string): string | null {
  if (!entityId || action.endsWith('_DELETE')) return null;
  switch (entityType) {
    case 'sites':
      return `/sites/${entityId}`;
    case 'pm_visit':
    case 'pm_visits':
      return `/visits/${entityId}`;
    case 'pm_schedules':
      return `/schedule/${entityId}`;
    case 'failures':
      return `/failures/${entityId}`;
    case 'corrective_actions':
      return `/corrective-actions/${entityId}`;
    case 'pm_templates':
      return `/admin/templates/${entityId}`;
    case 'profiles':
    case 'profile':
      return `/admin/users/${entityId}`;
    default:
      return null;
  }
}

/** "SITE_ASSIGNMENT_INSERT" -> "Site assignment created". */
export function auditActionLabel(action: string): string {
  const verbs: Record<string, string> = { INSERT: 'created', UPDATE: 'changed', DELETE: 'deleted' };
  const m = action.match(/^(.*)_(INSERT|UPDATE|DELETE)$/);
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\bpm\b/g, 'PM')
      .replace(/^\w/, (c) => c.toUpperCase());
  return m ? `${words(m[1]!)} ${verbs[m[2]!]}` : words(action);
}

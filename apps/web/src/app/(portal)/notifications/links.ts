const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATHS: Record<string, string> = { visit: '/visits', schedule: '/schedule', site: '/sites', failure: '/failures', action: '/corrective-actions' };

/** The page a notification is about (null: none, or not a known record). */
export function notificationHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId || !UUID.test(entityId) || !PATHS[entityType]) return null;
  return `${PATHS[entityType]}/${entityId}`;
}

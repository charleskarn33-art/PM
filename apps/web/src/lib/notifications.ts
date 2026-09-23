/** Where a notification leads in the web portal. */
export function notificationHref(entityType: string | null, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case 'pm_visit':
      return `/visits/${entityId}`;
    case 'pm_schedule':
      return `/schedule/${entityId}`;
    case 'corrective_action':
      return `/corrective-actions/${entityId}`;
    case 'failure':
      return `/failures/${entityId}`;
    case 'site':
      return `/sites/${entityId}`;
    default:
      return null;
  }
}

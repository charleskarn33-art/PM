/** Where a notification opens in the app (null: nowhere specific). */
export function notificationRoute(entityType: string | null | undefined, entityId: string | null | undefined, pmWork: boolean): string | null {
  const id = entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : null;
  switch (entityType) {
    case 'visit':
      return pmWork && id ? `/pm/${id}` : null;
    case 'action':
      return id ? `/action/${id}` : '/actions';
    case 'site':
      return pmWork && id ? `/site/${id}` : null;
    case 'schedule':
      return pmWork ? '/pm' : null;
    case 'failure':
      return '/actions';
    default:
      return null;
  }
}

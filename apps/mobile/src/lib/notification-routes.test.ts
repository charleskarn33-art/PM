import { describe, expect, it } from 'vitest';
import { notificationRoute } from './notification-routes';

const ID = '01a0e7cf-15d8-730e-9bc0-2651f0fcc494';

describe('notificationRoute', () => {
  it('opens the record a notification is about', () => {
    expect(notificationRoute('visit', ID, true)).toBe(`/pm/${ID}`);
    expect(notificationRoute('action', ID, true)).toBe(`/action/${ID}`);
    expect(notificationRoute('site', ID, true)).toBe(`/site/${ID}`);
    expect(notificationRoute('schedule', ID, true)).toBe('/pm');
    expect(notificationRoute('failure', ID, true)).toBe('/actions');
  });
  it('keeps maintenance users to their screens and ignores unknown data', () => {
    expect(notificationRoute('visit', ID, false)).toBeNull();
    expect(notificationRoute('action', ID, false)).toBe(`/action/${ID}`);
    expect(notificationRoute('visit', '../../evil', true)).toBeNull();
    expect(notificationRoute('something', ID, true)).toBeNull();
    expect(notificationRoute(null, null, true)).toBeNull();
  });
});

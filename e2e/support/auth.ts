import './env';
import type { BrowserContext, Page } from '@playwright/test';
import { ids } from './db';
import { E2E, gatewayUrl } from './env';
import { sessionFor } from './gateway';

export const users = {
  admin: { id: ids.admin, email: 'admin@test.local' },
  viewer: { id: ids.viewer, email: 'viewer@test.local' },
  manager: { id: ids.managerA, email: 'manager.a@test.local' },
  supervisor: { id: ids.supervisorA, email: 'supervisor.a@test.local' },
  supervisorB: { id: ids.supervisorB, email: 'supervisor.b@test.local' },
  technician: { id: ids.techA, email: 'tech.a@test.local' },
  maintenance: { id: ids.maintenance, email: 'maintenance@test.local' },
  inactive: { id: ids.inactiveTech, email: 'inactive@test.local' },
} as const;
export type UserKey = keyof typeof users;

/** Supabase SSR cookie name for the gateway URL (sb-<first host label>-auth-token). */
const COOKIE = `sb-${new URL(gatewayUrl).hostname.split('.')[0]}-auth-token`;

/**
 * Signs the browser in as a fixture user without the login form (the form
 * itself is covered in auth.spec). Same cookie a real sign-in sets.
 */
export async function signInAs(context: BrowserContext, who: UserKey): Promise<void> {
  const session = sessionFor(users[who]);
  await context.clearCookies();
  await context.addCookies([
    { name: COOKIE, value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, url: E2E.webUrl, httpOnly: false, sameSite: 'Lax' },
  ]);
}

export async function pageAs(page: Page, who: UserKey): Promise<Page> {
  await signInAs(page.context(), who);
  return page;
}

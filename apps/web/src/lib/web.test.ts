import { describe, expect, it } from 'vitest';
import { assertNoPublicSecrets } from './env';
import { breadcrumbsFor, homeFor, navigationFor } from './navigation';
import { isPublicPath, safeNextPath } from './routes';

describe('routes', () => {
  it('identifies public paths', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/change-password')).toBe(false);
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/auth/set-password')).toBe(false);
    expect(isPublicPath('/dashboard')).toBe(false);
  });
  it('only allows safe same-site redirects', () => {
    expect(safeNextPath('/profile')).toBe('/profile');
    expect(safeNextPath('https://evil.example')).toBe('/dashboard');
    expect(safeNextPath('//evil.example')).toBe('/dashboard');
    expect(safeNextPath('/\\evil.example')).toBe('/dashboard');
    expect(safeNextPath('/login')).toBe('/dashboard');
    expect(safeNextPath(undefined)).toBe('/dashboard');
    // Characters browsers strip or rewrite, which would turn the path into //host.
    expect(safeNextPath('/\t/evil.example')).toBe('/dashboard');
    expect(safeNextPath('/\n/evil.example')).toBe('/dashboard');
    expect(safeNextPath('/%09/evil.example')).toBe('/%09/evil.example'); // stays an encoded same-site path
    expect(safeNextPath('/login/../dashboard')).toBe('/dashboard');
    expect(safeNextPath('/visits?status=ALL#top')).toBe('/visits?status=ALL#top');
  });
});

describe('assertNoPublicSecrets', () => {
  it('rejects secrets with a browser-visible prefix', () => {
    expect(() => assertNoPublicSecrets({ NEXT_PUBLIC_API_SECRET: 'x' })).toThrow(/NEXT_PUBLIC_API_SECRET/);
    expect(() => assertNoPublicSecrets({ WEB_FORWARD_SECRET: 'x', NEXT_PUBLIC_APP_NAME: 'IPT' })).not.toThrow();
  });
});

describe('navigation', () => {
  const ADMIN = ['users.read', 'users.manage', 'org.manage', 'sites.read', 'pm_templates.manage', 'settings.manage', 'analytics.read', 'audit.read', 'pm_schedules.read', 'pm_visits.read', 'failures.read', 'corrective_actions.read', 'reports.read'];
  const SUPERVISOR = ['users.read', 'sites.read', 'analytics.read', 'pm_schedules.read', 'pm_visits.read', 'failures.read', 'corrective_actions.read', 'reports.read'];
  const MAINTENANCE = ['sites.read', 'failures.read', 'corrective_actions.read', 'corrective_actions.work'];
  const labels = (p: string[]) => navigationFor(p).flatMap((s) => s.items.map((i) => i.label));

  it('follows the API permissions', () => {
    expect(labels(ADMIN)).toEqual(expect.arrayContaining(['Dashboard', 'Users', 'Organization', 'PM Templates', 'Settings']));
    expect(labels(SUPERVISOR)).not.toContain('Users');
    expect(labels(SUPERVISOR)).toContain('Technicians');
    expect(labels(MAINTENANCE)).toEqual(['Sites', 'Failures', 'Corrective Actions', 'Notifications', 'My Profile']);
  });
  it('shows what later phases bring as not yet available', () => {
    const planned = navigationFor(ADMIN).flatMap((s) => s.items).filter((i) => i.plannedPhase).map((i) => `${i.label}:${i.plannedPhase}`);
    expect(planned).toEqual(['Reports:11', 'Audit Log:13', 'Notifications:12']);
  });
  it('lands on the first page the user may open', () => {
    expect(homeFor(ADMIN)).toBe('/dashboard');
    expect(homeFor(MAINTENANCE)).toBe('/sites');
  });
  it('builds breadcrumbs from navigation labels', () => {
    expect(breadcrumbsFor('/profile')).toEqual([{ label: 'IPT PowerTech PM', href: '/dashboard' }, { label: 'My Profile' }]);
  });
});

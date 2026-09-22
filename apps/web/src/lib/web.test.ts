import { describe, expect, it } from 'vitest';
import { derivePmKpis, monthPeriod } from './dashboard';
import { readPublicEnv } from './env';
import { breadcrumbsFor, navigationFor } from './navigation';
import { isPublicPath, safeNextPath } from './routes';

describe('derivePmKpis', () => {
  it('derives pending and completion percentage', () => {
    expect(derivePmKpis({ scheduled: 40, completed: 30, overdue: 4 })).toEqual({
      scheduled: 40,
      completed: 30,
      overdue: 4,
      pending: 6,
      completionPct: 75,
    });
  });
  it('rounds completion to one decimal', () => {
    expect(derivePmKpis({ scheduled: 3, completed: 1, overdue: 0 }).completionPct).toBe(33.3);
  });
  it('reports no completion percentage when nothing is scheduled', () => {
    expect(derivePmKpis({ scheduled: 0, completed: 0, overdue: 0 })).toMatchObject({ pending: 0, completionPct: null });
  });
});

describe('monthPeriod', () => {
  it('returns the calendar month bounds', () => {
    const p = monthPeriod(new Date(2026, 1, 10));
    expect(p).toMatchObject({ today: '2026-02-10', monthStart: '2026-02-01', monthEnd: '2026-02-28' });
  });
});

describe('readPublicEnv', () => {
  const url = 'https://abc.supabase.co';
  it('accepts the publishable key or legacy anon key', () => {
    expect(readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }))
      .toEqual({ supabaseUrl: url, supabaseKey: 'sb_publishable_x' });
    expect(readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon' }).supabaseKey).toBe('anon');
  });
  it('fails loudly when configuration is missing', () => {
    expect(() => readPublicEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    expect(() => readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'not a url', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toThrow(
      /not a valid URL/,
    );
  });
  it('refuses secret keys in the browser app', () => {
    expect(() =>
      readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }),
    ).toThrow(/secret/);
  });
});

describe('routes', () => {
  it('identifies public paths', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/dashboard')).toBe(false);
  });
  it('only allows safe same-site redirects', () => {
    expect(safeNextPath('/profile')).toBe('/profile');
    expect(safeNextPath('https://evil.example')).toBe('/dashboard');
    expect(safeNextPath('//evil.example')).toBe('/dashboard');
    expect(safeNextPath('/\\evil.example')).toBe('/dashboard');
    expect(safeNextPath('/login')).toBe('/dashboard');
    expect(safeNextPath(undefined)).toBe('/dashboard');
  });
});

describe('navigation', () => {
  const labels = (role: Parameters<typeof navigationFor>[0]) =>
    navigationFor(role).flatMap((s) => s.items.map((i) => i.label));

  it('shows administration only to super admins', () => {
    expect(labels('super_admin')).toContain('Users');
    expect(labels('regional_supervisor')).not.toContain('Users');
    expect(labels('viewer')).not.toContain('PM Templates');
  });
  it('gives technicians a field-focused menu', () => {
    expect(labels('technician')).toEqual(['Dashboard', 'Sites', 'Failures', 'Corrective Actions', 'My Profile']);
  });
  it('builds breadcrumbs from navigation labels', () => {
    expect(breadcrumbsFor('/profile')).toEqual([
      { label: 'IPT PowerTech PM', href: '/dashboard' },
      { label: 'My Profile' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { appRole, toAccountProfile } from './account';

describe('account profile', () => {
  it('prefers field roles, then the most privileged', () => {
    expect(appRole(['VIEWER', 'TECHNICIAN'])).toBe('technician');
    expect(appRole(['MAINTENANCE_USER'])).toBe('maintenance');
    expect(appRole(['REGIONAL_SUPERVISOR', 'SUPER_ADMIN'])).toBe('super_admin');
    expect(appRole([])).toBeNull();
  });

  it('maps the API profile to what the screens show', () => {
    expect(
      toAccountProfile({
        id: 'u1',
        email: 'abraham.cole@example.com',
        fullName: 'Abraham Cole',
        phone: null,
        isActive: true,
        mustChangePassword: true,
        roles: [{ code: 'TECHNICIAN', name: 'Technician' }],
      }),
    ).toEqual({ id: 'u1', email: 'abraham.cole@example.com', full_name: 'Abraham Cole', phone: null, role: 'technician', is_active: true, must_change_password: true });
  });
});

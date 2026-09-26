import { describe, expect, it } from 'vitest';
import { managesRegion, siteScope, userScope, within } from './scope.js';

const admin = { id: 'a', isGlobal: true, regionIds: [] };
const sup = { id: 's', isGlobal: false, regionIds: ['r1'] };
const tech = { id: 't', isGlobal: false, regionIds: [] };

describe('scope filters', () => {
  it('do not restrict users with access everywhere', () => {
    expect(siteScope(admin)).toBeUndefined();
    expect(userScope(admin)).toBeUndefined();
    expect(within(siteScope(admin), { id: 'x' })).toEqual({ id: 'x' });
  });

  it('limit others to their regions and active assignments', () => {
    expect(siteScope(sup)).toEqual({ OR: [{ regionId: { in: ['r1'] } }, { assignments: { some: { userId: 's', active: true } } }] });
    // No regions: only assigned sites (an empty IN matches nothing).
    expect(siteScope(tech)).toEqual({ OR: [{ regionId: { in: [] } }, { assignments: { some: { userId: 't', active: true } } }] });
    expect(within(siteScope(sup), { id: 'x' })).toEqual({ AND: [siteScope(sup), { id: 'x' }] });
  });

  it('changes are limited to regions in scope, not merely visible ones', () => {
    expect(managesRegion(admin, 'r9')).toBe(true);
    expect(managesRegion(sup, 'r1')).toBe(true);
    expect(managesRegion(sup, 'r2')).toBe(false);
    expect(managesRegion(tech, 'r1')).toBe(false);
  });
});

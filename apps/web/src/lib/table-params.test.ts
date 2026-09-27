import { describe, expect, it } from 'vitest';
import { parseTableParams, tableHref } from './table-params';

const config = { sortable: ['site_code', 'site_name'] as const, defaultSort: 'site_code' as const, filters: ['region'] };

describe('parseTableParams', () => {
  it('applies defaults', () => {
    expect(parseTableParams({}, config)).toMatchObject({ page: 1, pageSize: 25, sort: 'site_code', dir: 'asc', q: '', filters: {} });
  });
  it('whitelists sort columns, page sizes and directions', () => {
    const p = parseTableParams({ sort: 'password', dir: 'sideways', size: '9999', page: '-3' }, config);
    expect(p).toMatchObject({ sort: 'site_code', dir: 'asc', pageSize: 25, page: 1 });
    expect(parseTableParams({ sort: 'site_name', dir: 'desc', size: '100', page: '4' }, config)).toMatchObject({
      sort: 'site_name',
      dir: 'desc',
      pageSize: 100,
      page: 4,
    });
  });
  it('reads declared filters and hidden columns only', () => {
    const p = parseTableParams({ region: 'r1', other: 'x', hide: 'county,cluster', q: '  tienii ' }, config);
    expect(p.filters).toEqual({ region: 'r1' });
    expect([...p.hidden]).toEqual(['county', 'cluster']);
    expect(p.q).toBe('tienii');
  });
});

describe('tableHref', () => {
  it('merges and removes params', () => {
    expect(tableHref('/sites', { q: 'a', page: '3', region: '' }, { page: null, sort: 'site_name' })).toBe('/sites?q=a&sort=site_name');
    expect(tableHref('/sites', {}, {})).toBe('/sites');
  });
});

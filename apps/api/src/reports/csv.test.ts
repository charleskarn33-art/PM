import { describe, expect, it } from 'vitest';
import { csvCell, csvRow } from './csv.js';
import { batched } from './exports.service.js';

describe('csv', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvRow(['a,b', 'say "hi"', 'two\nlines', 3, null, true])).toBe('"a,b","say ""hi""","two\nlines",3,,Yes\r\n');
  });
  it('keeps typed text from running as a formula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM')).toBe("'@SUM");
    expect(csvCell(-2)).toBe('-2');
  });
  it('writes dates as ISO and drops non-finite numbers', () => {
    expect(csvCell(new Date('2026-09-28T10:00:00Z'))).toBe('2026-09-28T10:00:00.000Z');
    expect(csvCell(Number.NaN)).toBe('');
  });
});

describe('batched export reading', () => {
  it('reads every row, a batch at a time, continuing after the last id', async () => {
    const all = Array.from({ length: 7 }, (_, i) => ({ id: `id-${i}` }));
    const pages: unknown[] = [];
    const fetch = async (p: { take: number; cursor?: { id: string } }) => {
      pages.push(p.cursor?.id ?? null);
      const start = p.cursor ? all.findIndex((r) => r.id === p.cursor!.id) + 1 : 0;
      return all.slice(start, start + p.take);
    };
    const out: string[] = [];
    for await (const r of batched(fetch, 3)) out.push(r.id);
    expect(out).toEqual(all.map((r) => r.id));
    expect(pages).toEqual([null, 'id-2', 'id-5']);
  });
});

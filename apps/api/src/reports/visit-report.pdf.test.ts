import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { signatureSvg } from '../pm/visits.service.js';
import { parseSignature, printable, renderVisitReport, type ReportData } from './visit-report.pdf.js';

const base = (over: Partial<ReportData> = {}): ReportData => ({
  organisation: 'IPT PowerTech',
  title: 'Preventative Maintenance Report',
  isDemo: false,
  generatedAt: '28 Sept 2026, 10:00',
  header: [{ label: 'Site', value: 'GCM-1301 - Tienii' }],
  sections: [
    {
      name: 'Generator',
      notApplicable: false,
      readings: [{ label: 'Running Hours (h)', value: '1,250 h' }],
      answers: [
        { prompt: 'Is Automation Working?', answer: 'No', comment: 'ATS controller dead', failure: true },
        { prompt: 'Is the machine burning oil?', answer: 'No', comment: null, failure: false },
      ],
      photos: [],
      calculated: [],
      units: [],
    },
    { name: 'Solar', notApplicable: true, readings: [], answers: [], photos: [], calculated: [], units: [] },
  ],
  otherPhotos: [],
  failures: [{ number: 'FL-000001', title: 'Is Automation Working?', severity: 'Medium', status: 'Open' }],
  overallComments: 'All good otherwise',
  review: [{ label: 'Review', value: 'Waiting for a supervisor' }],
  signature: null,
  ...over,
});

/** Text drawn in an uncompressed PDF (pdfkit writes it as hex strings). */
function textOf(pdf: Buffer): string {
  const hex = [...pdf.toString('latin1').matchAll(/<([0-9a-f]+)> -?\d*/g)].map((m) => Buffer.from(m[1]!, 'hex').toString('latin1'));
  return hex.join('');
}

describe('visit report PDF', () => {
  it('prints the header, sections, failures and review', async () => {
    const pdf = await renderVisitReport(base(), { compress: false });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = textOf(pdf);
    for (const s of ['IPT PowerTech', 'GCM-1301', 'Running Hours', 'Is Automation Working?', 'FAILURE', 'ATS controller dead', 'Not applicable', 'FL-000001', 'Waiting for a supervisor', 'Not signed', 'Page 1 of 1'])
      expect(text).toContain(s);
    expect(text).not.toContain('DEMO DATA');
  });

  it('marks demo records, draws photos and the signature, and breaks pages', async () => {
    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3366cc' } }).jpeg().toBuffer();
    const many = Array.from({ length: 12 }, () => ({ data: jpeg, caption: 'Generator panel' }));
    const pdf = await renderVisitReport(
      base({ isDemo: true, otherPhotos: many, signature: { name: 'Abraham Cole', signedAt: '28 Sept 2026', svg: signatureSvg(300, 100, [[[10, 50], [80, 20]]]) } }),
      { compress: false },
    );
    const text = textOf(pdf);
    expect(text).toContain('DEMO DATA');
    expect(text).toContain('Abraham Cole');
    expect(text).toMatch(/Page 2 of \d/);
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
  });

  it('keeps only what the PDF fonts can print', () => {
    expect(printable('Café “ok” – 5 € ✅ 日本')).toBe('Café “ok” – 5 € ? ??');
    expect(printable('a\tb')).toBe('a b');
  });

  it('reads the API’s own signature drawing', () => {
    expect(parseSignature(signatureSvg(300, 100, [[[10, 50], [80, 20]], [[5, 5]]]))).toEqual({ width: 300, height: 100, d: 'M10 50L80 20M5 5l0.1 0' });
    expect(parseSignature('<svg/>')).toBeNull();
  });
});

import PDFDocument from 'pdfkit';

/**
 * The PM visit report as a PDF (A4), laid out like the source PM report: a
 * header with the site and visit, then each section with its readings, its
 * checklist answers (failures marked) and its photos, calculated DC and
 * battery figures, the failures raised, the review and the technician's
 * signature. Pure: everything it prints comes from `ReportData`.
 */

export interface ReportPhoto {
  /** JPEG or PNG bytes, already reduced for print. */
  data: Buffer;
  caption: string | null;
}

export interface ReportSection {
  name: string;
  notApplicable: boolean;
  readings: { label: string; value: string }[];
  answers: { prompt: string; answer: string; comment: string | null; failure: boolean }[];
  photos: ReportPhoto[];
  /** Calculated figures for this section (e.g. DC power), labelled as calculated. */
  calculated: { label: string; value: string }[];
  /** Per-unit rows (battery voltages). */
  units: { label: string; value: string }[];
}

export interface ReportData {
  organisation: string;
  title: string;
  isDemo: boolean;
  generatedAt: string;
  header: { label: string; value: string }[];
  sections: ReportSection[];
  otherPhotos: ReportPhoto[];
  failures: { number: string; title: string; severity: string; status: string }[];
  overallComments: string | null;
  review: { label: string; value: string }[];
  signature: { name: string | null; signedAt: string; svg: string | null } | null;
}

const MARGIN = 40;
const INK = '#1a1a1a';
const MUTED = '#5f5f5f';
const RULE = '#d6d6d6';
const FAIL = '#b3261e';
const FAIL_BG = '#fbeceb';

/**
 * The standard PDF fonts cover Windows-1252 only; anything else (emoji,
 * other scripts) would print as garbage, so it is replaced with "?".
 */
const WIN_ANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
export function printable(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (c === 0x0a || (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.includes(ch)) out += ch;
    else if (c === 0x09 || c === 0x0d) out += ' ';
    else if (c >= 0x20) out += '?';
  }
  return out;
}

/** The viewBox and path data of a signature drawn by the API (see `signatureSvg`). */
export function parseSignature(svg: string): { width: number; height: number; d: string } | null {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const path = /<path d="([MLl\d.\s-]*)"/.exec(svg);
  if (!box || !path) return null;
  return { width: Number(box[1]), height: Number(box[2]), d: path[1]! };
}

export function renderVisitReport(r: ReportData, opts: { compress?: boolean } = {}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, compress: opts.compress ?? true, info: { Title: printable(r.title), Author: printable(r.organisation) } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - 2 * MARGIN;
  const bottom = () => doc.page.height - MARGIN - 20;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const t = (s: string) => printable(s);

  const heading = (text: string) => {
    ensure(40);
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(t(text), MARGIN, doc.y, { width });
    const y = doc.y + 2;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + width, y).lineWidth(0.8).strokeColor(INK).stroke();
    doc.y = y + 6;
  };

  /** Label / value rows in two columns. */
  const pairs = (rows: { label: string; value: string }[], labelWidth = 170) => {
    for (const row of rows) {
      doc.font('Helvetica').fontSize(9);
      const h = Math.max(doc.heightOfString(t(row.label), { width: labelWidth - 8 }), doc.heightOfString(t(row.value), { width: width - labelWidth })) + 4;
      ensure(h);
      const y = doc.y;
      doc.fillColor(MUTED).text(t(row.label), MARGIN, y, { width: labelWidth - 8 });
      doc.fillColor(INK).text(t(row.value), MARGIN + labelWidth, y, { width: width - labelWidth });
      doc.y = y + h;
      doc.moveTo(MARGIN, doc.y - 2).lineTo(MARGIN + width, doc.y - 2).lineWidth(0.3).strokeColor(RULE).stroke();
    }
  };

  const subheading = (text: string) => {
    ensure(24);
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(t(text), MARGIN, doc.y, { width });
    doc.moveDown(0.2);
  };

  const answers = (rows: ReportSection['answers']) => {
    const qW = width * 0.55;
    const aW = width * 0.13;
    const cW = width - qW - aW;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    ensure(14);
    let y = doc.y;
    doc.text('Question', MARGIN, y, { width: qW - 6 });
    doc.text('Answer', MARGIN + qW, y, { width: aW - 6 });
    doc.text('Comment', MARGIN + qW + aW, y, { width: cW });
    doc.y = y + 12;
    for (const a of rows) {
      doc.font('Helvetica').fontSize(9);
      const answer = a.failure ? `${a.answer} - FAILURE` : a.answer;
      const h = Math.max(doc.heightOfString(t(a.prompt), { width: qW - 6 }), doc.heightOfString(t(answer), { width: aW - 6 }), doc.heightOfString(t(a.comment ?? ''), { width: cW })) + 5;
      ensure(h);
      y = doc.y;
      if (a.failure) doc.rect(MARGIN - 3, y - 2, width + 6, h).fill(FAIL_BG);
      doc.fillColor(INK).font('Helvetica').text(t(a.prompt), MARGIN, y, { width: qW - 6 });
      doc.fillColor(a.failure ? FAIL : INK).font(a.failure ? 'Helvetica-Bold' : 'Helvetica').text(t(answer), MARGIN + qW, y, { width: aW - 6 });
      doc.fillColor(INK).font('Helvetica').text(t(a.comment ?? ''), MARGIN + qW + aW, y, { width: cW });
      doc.y = y + h;
      doc.moveTo(MARGIN, doc.y - 2).lineTo(MARGIN + width, doc.y - 2).lineWidth(0.3).strokeColor(RULE).stroke();
    }
  };

  /** Photos in a grid, three to a row, each fitted into its cell. */
  const photos = (list: ReportPhoto[]) => {
    const gap = 8;
    const cellW = (width - 2 * gap) / 3;
    const cellH = cellW * 0.75;
    for (let i = 0; i < list.length; i += 3) {
      ensure(cellH + 26);
      const y = doc.y;
      let rowH = cellH;
      list.slice(i, i + 3).forEach((p, j) => {
        const x = MARGIN + j * (cellW + gap);
        try {
          doc.image(p.data, x, y, { fit: [cellW, cellH], align: 'center', valign: 'center' });
        } catch {
          doc.rect(x, y, cellW, cellH).lineWidth(0.5).strokeColor(RULE).stroke();
          doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Photo could not be printed', x, y + cellH / 2 - 4, { width: cellW, align: 'center' });
        }
        if (p.caption) {
          doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(t(p.caption), x, y + cellH + 2, { width: cellW, height: 20, ellipsis: true });
          rowH = cellH + 22;
        }
      });
      doc.y = y + rowH + gap;
    }
  };

  // --- Header ------------------------------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(t(r.organisation), MARGIN, MARGIN, { width });
  doc.font('Helvetica').fontSize(12).fillColor(MUTED).text(t(r.title), { width });
  if (r.isDemo) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(FAIL).text('DEMO DATA - seeded reference record, not live operations.', { width });
  }
  doc.moveDown(0.6);
  pairs(r.header);

  // --- Sections ----------------------------------------------------------------------------
  for (const s of r.sections) {
    heading(s.name);
    if (s.notApplicable) {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Not applicable at this site for this visit.', MARGIN, doc.y, { width });
      continue;
    }
    if (s.readings.length) {
      subheading('Readings');
      pairs(s.readings);
    }
    if (s.calculated.length) {
      subheading('Calculated');
      pairs(s.calculated);
    }
    if (s.units.length) {
      subheading('Battery voltages');
      pairs(s.units, 120);
    }
    if (s.answers.length) {
      subheading('Checklist');
      answers(s.answers);
    }
    if (s.photos.length) {
      subheading('Photos');
      photos(s.photos);
    }
    if (!s.readings.length && !s.answers.length && !s.photos.length) doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text('Nothing recorded.', MARGIN, doc.y, { width });
  }

  if (r.otherPhotos.length) {
    heading('Other photos');
    photos(r.otherPhotos);
  }

  heading('Failures raised');
  if (r.failures.length) {
    pairs(r.failures.map((f) => ({ label: `${f.number} (${f.severity})`, value: `${f.title} - ${f.status}` })), 130);
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('No failures raised by this visit.', MARGIN, doc.y, { width });
  }

  heading('Comments and review');
  pairs([{ label: 'Technician comments', value: r.overallComments ?? '-' }, ...r.review]);

  // --- Signature ---------------------------------------------------------------------------
  heading('Technician signature');
  if (r.signature) {
    const sig = r.signature.svg ? parseSignature(r.signature.svg) : null;
    const boxW = 220;
    const boxH = 80;
    ensure(boxH + 40);
    const y = doc.y;
    if (sig) {
      const scale = Math.min(boxW / sig.width, boxH / sig.height);
      doc.save().translate(MARGIN, y).scale(scale).path(sig.d).lineWidth(3).lineCap('round').lineJoin('round').strokeColor(INK).stroke().restore();
    }
    doc.moveTo(MARGIN, y + boxH + 4).lineTo(MARGIN + boxW, y + boxH + 4).lineWidth(0.5).strokeColor(MUTED).stroke();
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(t(`${r.signature.name ?? 'Technician'} - signed ${r.signature.signedAt}`), MARGIN, y + boxH + 8, { width });
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text('Not signed.', MARGIN, doc.y, { width });
  }

  // --- Footer on every page ----------------------------------------------------------------
  const range = doc.bufferedPageRange();
  // The footer sits in the bottom margin; without this pdfkit would start a new page for it.
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN;
    doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
    doc.text(t(`${r.title} - generated ${r.generatedAt}${r.isDemo ? ' - DEMO DATA' : ''}`), MARGIN, y, { width: width - 60, lineBreak: false, height: 10 });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, MARGIN + width - 60, y, { width: 60, align: 'right', lineBreak: false, height: 10 });
  }
  doc.end();
  return done;
}

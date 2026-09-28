import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { AuthUser } from '../auth/auth-user.js';
import { AppConfig } from '../config/app-config.js';
import { failureNumber } from '../failures/failure-rules.js';
import { VisitsService } from '../pm/visits.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { renderVisitReport, type ReportData, type ReportPhoto, type ReportSection } from './visit-report.pdf.js';

type Visit = Awaited<ReturnType<VisitsService['get']>>;

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed - waiting for review',
  APPROVED: 'Approved',
  REJECTED: 'Returned for correction',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};
const GPS_LABEL: Record<string, string> = {
  WITHIN_RADIUS: 'Within the site radius',
  OUTSIDE_RADIUS: 'Outside the site radius',
  NO_LOCATION: 'Location unavailable',
  SITE_HAS_NO_COORDINATES: 'Site has no coordinates',
};
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');

/** Photos are reduced for print (longest side, pixels). */
const PHOTO_PX = 1200;

/** Builds the PM visit report from the stored visit (scoped like the visit itself). */
@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly visits: VisitsService,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}

  private when(at: Date | string | null | undefined): string {
    if (!at) return '-';
    return new Intl.DateTimeFormat('en-GB', { timeZone: this.config.orgTimezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(at));
  }

  /** The PDF and a file name for it. */
  async visitReport(visitId: string, caller: AuthUser): Promise<{ pdf: Buffer; fileName: string }> {
    const visit = await this.visits.get(visitId, caller); // 404 outside the caller's scope
    const [site, photoRows, failures, signed] = await Promise.all([
      this.prisma.site.findUniqueOrThrow({
        where: { id: visit.siteId },
        select: { siteCode: true, siteName: true, isDemo: true, region: { select: { name: true } }, county: { select: { name: true } }, latitude: true, longitude: true },
      }),
      this.prisma.pmPhoto.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' }, select: { id: true, checklistItemId: true, storageKey: true, caption: true } }),
      this.prisma.failure.findMany({ where: { visitId }, orderBy: { number: 'asc' }, select: { number: true, title: true, severity: true, status: true } }),
      this.prisma.pmVisit.findUniqueOrThrow({ where: { id: visitId }, select: { signatureKey: true } }),
    ]);
    const images = new Map<string, ReportPhoto>();
    await Promise.all(
      photoRows.map(async (p) => {
        const data = await this.printable(p.storageKey);
        if (data) images.set(p.id, { data, caption: p.caption });
      }),
    );
    const svg = signed.signatureKey ? await this.storage.get(signed.signatureKey).then((b) => b.toString('utf8')).catch(() => null) : null;
    const data = this.reportData(visit, site, photoRows, images, failures, svg);
    const pdf = await renderVisitReport(data);
    const day = (visit.completedAt ?? visit.startedAt).toISOString().slice(0, 10);
    return { pdf, fileName: `PM-${site.siteCode}-${day}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_') };
  }

  /** A stored photo as JPEG for the PDF (WebP is not supported by PDF viewers); null if it cannot be read. */
  private async printable(key: string): Promise<Buffer | null> {
    try {
      const raw = await this.storage.get(key);
      return await sharp(raw).rotate().resize(PHOTO_PX, PHOTO_PX, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    } catch (e) {
      this.log.warn({ key, err: e instanceof Error ? e.message : String(e) }, 'photo left out of the report');
      return null;
    }
  }

  reportData(
    v: Visit,
    site: { siteCode: string; siteName: string; isDemo: boolean; region: { name: string }; county: { name: string } | null },
    photoRows: { id: string; checklistItemId: string | null }[],
    images: Map<string, ReportPhoto>,
    failures: { number: number; title: string; severity: string; status: string }[],
    signatureSvg: string | null,
  ): ReportData {
    const fieldValue = (r: { numericValue: number | null; textValue: string | null; unitSnapshot: string | null } | undefined) =>
      !r ? '-' : r.numericValue != null ? `${fmt(r.numericValue)}${r.unitSnapshot ? ` ${r.unitSnapshot}` : ''}` : (r.textValue ?? '-');
    const used = new Set<string>();
    const na = new Set(v.notApplicableSections);
    const m = v.modules as Record<string, Record<string, unknown> | null>;

    const sections: ReportSection[] = v.sections.map((s) => {
      const itemIds = new Set(s.items.map((i) => i.id));
      const photos = photoRows.filter((p) => p.checklistItemId && itemIds.has(p.checklistItemId) && images.has(p.id));
      photos.forEach((p) => used.add(p.id));
      const calculated: ReportSection['calculated'] = [];
      const units: ReportSection['units'] = [];
      if (s.category === 'DC_SYSTEM' && m.dc) {
        if (m.dc.dcPowerKw != null) calculated.push({ label: 'DC power (rectifier voltage x load current)', value: `${fmt(m.dc.dcPowerKw as number)} kW` });
        if (m.dc.totalPhaseCurrentA != null) calculated.push({ label: 'Total phase current (sum of phases)', value: `${fmt(m.dc.totalPhaseCurrentA as number)} A` });
      }
      if (s.category === 'BATTERY' && m.battery) {
        for (const u of (m.battery.units as { unitNumber: number; voltageV: number; comment: string | null }[] | undefined) ?? [])
          units.push({ label: `Battery ${u.unitNumber}`, value: `${fmt(u.voltageV)} V${u.comment ? ` - ${u.comment}` : ''}` });
        if (m.battery.minUnitVoltageV != null) calculated.push({ label: 'Lowest / highest battery', value: `${fmt(m.battery.minUnitVoltageV as number)} V / ${fmt(m.battery.maxUnitVoltageV as number)} V` });
      }
      return {
        name: s.name,
        notApplicable: na.has(s.code),
        // The value carries the unit (template labels often name it already, e.g. "Fuel Level (%)").
        readings: s.readingFields.map((f) => ({ label: f.label, value: fieldValue(v.readings.find((r) => r.readingFieldId === f.id)) })),
        answers: s.items.flatMap((i) => {
          const r = v.responses.find((x) => x.checklistItemId === i.id);
          if (!r) return [];
          return [{ prompt: i.prompt, answer: answerText(r, i.unit), comment: r.comment, failure: r.isFailure }];
        }),
        photos: photos.map((p) => images.get(p.id)!),
        calculated,
        units,
      };
    });

    const reviewed = v.reviewedAt
      ? [
          { label: 'Reviewed by', value: v.reviewedBy?.fullName ?? '-' },
          { label: 'Reviewed at', value: this.when(v.reviewedAt) },
          { label: 'Review comments', value: v.reviewComments ?? '-' },
        ]
      : [{ label: 'Review', value: v.status === 'COMPLETED' ? 'Waiting for a supervisor' : 'Not reviewed' }];

    return {
      organisation: this.config.orgName,
      title: 'Preventative Maintenance Report',
      isDemo: site.isDemo || v.isDemo,
      generatedAt: this.when(new Date()),
      header: [
        { label: 'Site', value: `${site.siteCode} - ${site.siteName}` },
        { label: 'Region / County', value: `${site.region.name}${site.county ? ` / ${site.county.name}` : ''}` },
        { label: 'Technician', value: v.technician.fullName },
        { label: 'Checklist', value: `${v.template.name} (version ${v.template.version})` },
        { label: 'Started', value: this.when(v.startedAt) },
        { label: 'Completed', value: this.when(v.completedAt) },
        ...(v.schedule ? [{ label: 'Due date', value: v.schedule.dueDate }] : []),
        { label: 'Status', value: STATUS_LABEL[v.status] ?? title(v.status) },
        { label: 'Checklist completion', value: `${fmt(v.completionPct ?? 0)}%` },
        {
          label: 'Location at start',
          value: v.gpsStatus
            ? `${GPS_LABEL[v.gpsStatus] ?? title(v.gpsStatus)}${v.gpsDistanceM != null ? ` (${fmt(v.gpsDistanceM)} m from the site)` : ''}${v.outsideRadiusReason ? ` - reason: ${v.outsideRadiusReason}` : ''}`
            : 'Not recorded',
        },
      ],
      sections,
      otherPhotos: photoRows.filter((p) => !used.has(p.id) && images.has(p.id)).map((p) => images.get(p.id)!),
      failures: failures.map((f) => ({ number: failureNumber(f.number), title: f.title, severity: title(f.severity), status: title(f.status) })),
      overallComments: v.overallComments,
      review: reviewed,
      signature: v.signature ? { name: v.signature.signedName, signedAt: this.when(v.signature.signedAt), svg: signatureSvg } : null,
    };
  }
}

const fmt = (n: number) => n.toLocaleString('en-GB', { maximumFractionDigits: 3 });

function answerText(
  r: { answer: string | null; numericValue: number | null; textValue: string | null; selectedOptions: string[] | null; dateValue: string | null; datetimeValue: Date | null },
  unit: string | null,
): string {
  if (r.answer) return r.answer === 'NA' ? 'N/A' : title(r.answer);
  if (r.numericValue != null) return `${fmt(r.numericValue)}${unit ? ` ${unit}` : ''}`;
  if (r.selectedOptions?.length) return r.selectedOptions.join(', ');
  if (r.dateValue) return r.dateValue;
  if (r.datetimeValue) return r.datetimeValue.toISOString().slice(0, 16).replace('T', ' ');
  return r.textValue ?? '-';
}

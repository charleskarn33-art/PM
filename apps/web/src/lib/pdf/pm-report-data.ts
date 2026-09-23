import 'server-only';
import { isFailure, type Database, type DcThresholds, type Tables } from '@ipt/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadVisitDetail, signPhotoUrls, type VisitDetail } from '../pm-visit';

type Client = SupabaseClient<Database>;

export interface ReportPhoto {
  id: string;
  itemId: string | null;
  sectionId: string | null;
  takenAt: string;
  /** JPEG/PNG bytes, or null when the file could not be fetched. */
  data: Buffer | null;
  format: 'jpg' | 'png';
}

export interface PmReportData {
  detail: VisitDetail;
  site: Pick<Tables<'site_overview'>, 'site_code' | 'site_name' | 'region_name' | 'county_name' | 'latitude' | 'longitude' | 'address'> | null;
  failures: Pick<Tables<'failure_overview'>, 'failure_number' | 'severity' | 'status' | 'description' | 'item_prompt'>[];
  photos: ReportPhoto[];
  photosOmitted: number;
  dcThresholds: DcThresholds | null;
  generatedAt: string;
  generatedBy: string;
}

/** Evidence photos embedded in the report; beyond this the report lists how many were left out. */
export const MAX_REPORT_PHOTOS = 24;

async function fetchImage(url: string): Promise<{ data: Buffer; format: 'jpg' | 'png' } | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    const format = type.includes('png') ? 'png' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
    if (!format) return null;
    return { data: Buffer.from(await res.arrayBuffer()), format };
  } catch {
    return null;
  }
}

/** Everything the printed PM report needs, read as the signed-in user (RLS). */
export async function loadPmReportData(supabase: Client, visitId: string, generatedBy: string): Promise<PmReportData | null> {
  const detail = await loadVisitDetail(supabase, visitId);
  if (!detail) return null;
  const [site, failures] = await Promise.all([
    supabase
      .from('site_overview')
      .select('site_code, site_name, region_name, county_name, latitude, longitude, address')
      .eq('id', detail.raw.site_id)
      .maybeSingle(),
    supabase.from('failure_overview').select('failure_number, severity, status, description, item_prompt').eq('visit_id', visitId).order('failure_number'),
  ]);
  if (site.error) throw new Error(`Unable to load site: ${site.error.message}`);
  if (failures.error) throw new Error(`Unable to load failures: ${failures.error.message}`);

  // Failing items first, so the evidence that matters is never the part left out.
  const failingItems = new Set(detail.items.filter((i) => isFailure(i, detail.responses.find((r) => r.checklist_item_id === i.id)?.answer)).map((i) => i.id));
  const ordered = [...detail.photos].sort((a, b) => Number(failingItems.has(b.checklist_item_id ?? '')) - Number(failingItems.has(a.checklist_item_id ?? '')));
  const chosen = ordered.slice(0, MAX_REPORT_PHOTOS);
  const urls = await signPhotoUrls(supabase, chosen, 300);
  const photos = await Promise.all(
    chosen.map(async (p): Promise<ReportPhoto> => {
      const u = urls.get(p.id);
      const img = u?.full ? await fetchImage(u.full) : null;
      return { id: p.id, itemId: p.checklist_item_id, sectionId: p.section_id, takenAt: p.taken_at, data: img?.data ?? null, format: img?.format ?? 'jpg' };
    }),
  );

  return {
    detail,
    site: site.data,
    failures: failures.data ?? [],
    photos,
    photosOmitted: Math.max(0, detail.photos.length - chosen.length),
    dcThresholds: detail.dcThresholds,
    generatedAt: new Date().toISOString(),
    generatedBy,
  };
}

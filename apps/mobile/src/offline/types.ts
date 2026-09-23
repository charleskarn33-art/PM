import type { ConsistencyRule, DcThresholds, Enums, Tables } from '@ipt/shared';

/** Site as downloaded (the site_overview view: names of region, county, supervisor, next PM). */
export type Site = Tables<'site_overview'> & { id: string; site_code: string; site_name: string };
export type Schedule = Tables<'pm_schedules'>;
export type Visit = Tables<'pm_visits'>;
export type Section = Tables<'pm_sections'>;
export type Item = Tables<'pm_checklist_items'>;
export type Field = Tables<'pm_reading_fields'>;
export type ServerResponse = Tables<'pm_responses'>;
export type ServerReading = Tables<'pm_readings'>;
export type ServerPhoto = Tables<'pm_photos'>;

export type BundleSection = Section & { items: Item[]; fields: Field[] };
export type BundleTemplate = Tables<'pm_templates'> & { sections: BundleSection[] };
export type BundleVisit = Visit & { responses: ServerResponse[]; readings: ServerReading[]; photos: ServerPhoto[] };

export interface GeofenceSetting {
  radius_m?: number | null;
  mode?: Enums<'geofence_mode'> | null;
}
export interface PmSubmissionSetting {
  enforce_photo_requirements?: boolean | null;
}
export interface BundleSettings {
  geofence?: GeofenceSetting;
  pm_submission?: PmSubmissionSetting;
  dc_thresholds?: DcThresholds;
}

/** Shape returned by public.mobile_sync_bundle(). */
export interface SyncBundle {
  generated_at: string;
  sites: Site[];
  schedules: Schedule[];
  templates: BundleTemplate[];
  visits: BundleVisit[];
  settings: BundleSettings;
  consistency_rules: ConsistencyRule[];
}

/** Answer as held on the phone (the editable columns only). */
export type LocalResponse = Pick<
  ServerResponse,
  'checklist_item_id' | 'answer' | 'numeric_value' | 'text_value' | 'selected_options' | 'date_value' | 'datetime_value' | 'comment'
> & { is_failure?: boolean | null };
export type LocalReading = Pick<ServerReading, 'reading_field_id' | 'numeric_value' | 'text_value'>;

export interface LocalPhoto {
  id: string;
  visit_id: string;
  site_id: string;
  section_id: string | null;
  checklist_item_id: string | null;
  /** Server path inside the pm-photos bucket. */
  file_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  latitude: number | null;
  longitude: number | null;
  taken_at: string;
  /** File on this phone (null once only the server copy exists). */
  local_uri: string | null;
  thumb_uri: string | null;
  pending: boolean;
}

export type OpKind = 'visit.create' | 'visit.update' | 'visit.submit' | 'response.upsert' | 'reading.upsert' | 'photo.upload';
export type OpState = 'PENDING' | 'SYNCING' | 'ERROR';

export interface OutboxOp {
  seq: number;
  key: string;
  kind: OpKind;
  visit_id: string;
  payload: Record<string, unknown>;
  state: OpState;
  version: number;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Payload of a photo.upload op: the metadata row plus where the files are on the phone. */
export interface PhotoUploadPayload {
  row: {
    id: string;
    site_id: string;
    visit_id: string;
    section_id: string | null;
    checklist_item_id: string | null;
    bucket: 'pm-photos';
    file_path: string;
    thumbnail_path: string | null;
    mime_type: string;
    size_bytes: number | null;
    width: number | null;
    height: number | null;
    latitude: number | null;
    longitude: number | null;
    taken_at: string;
  };
  local_uri: string;
  thumb_uri: string | null;
}

/** Photo storage paths follow the bucket convention <site>/<visit>/<photo>.jpg. */
export function photoPaths(siteId: string, visitId: string, photoId: string) {
  return { file: `${siteId}/${visitId}/${photoId}.jpg`, thumb: `${siteId}/${visitId}/${photoId}_thumb.jpg` };
}

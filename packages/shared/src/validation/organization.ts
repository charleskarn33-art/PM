import type { Enums } from '../database.types';
import {
  checkbox,
  CODE_PATTERN,
  isUuid,
  optionalNumber,
  optionalText,
  text,
  type FieldErrors,
  type RawInput,
  type ValidationResult,
} from './common';

export interface OrgUnitInput {
  code: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}

/**
 * Region / cluster / county input. Clusters require a region and counties a
 * cluster (`requireParent`).
 */
export function validateOrgUnit(
  raw: RawInput,
  requireParent: boolean,
): ValidationResult<OrgUnitInput, 'code' | 'name' | 'parent_id'> {
  const errors: FieldErrors<'code' | 'name' | 'parent_id'> = {};
  const code = text(raw, 'code').toUpperCase();
  const name = text(raw, 'name');
  const parent = optionalText(raw, 'parent_id');

  if (!CODE_PATTERN.test(code)) errors.code = 'Code is required: letters, digits, ".", "-" or "_" (max 32).';
  if (name.length < 2 || name.length > 120) errors.name = 'Name must be 2–120 characters.';
  if (requireParent && !isUuid(parent)) errors.parent_id = 'Select the parent.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { code, name, parent_id: parent, is_active: raw.is_active === undefined ? true : checkbox(raw, 'is_active') } };
}

export const SITE_STATUSES: readonly Enums<'site_status'>[] = ['ACTIVE', 'INACTIVE', 'DECOMMISSIONED'];

export interface SiteInput {
  site_code: string;
  site_name: string;
  region_id: string;
  cluster_id: string | null;
  county_id: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  site_type: string | null;
  power_configuration: string | null;
  generator_available: boolean;
  solar_available: boolean;
  battery_available: boolean;
  grid_available: boolean;
  status: Enums<'site_status'>;
  supervisor_id: string | null;
  geofence_radius_m: number | null;
}

export type SiteField = keyof SiteInput;

export function validateSite(raw: RawInput): ValidationResult<SiteInput, SiteField> {
  const errors: FieldErrors<SiteField> = {};
  const site_code = text(raw, 'site_code');
  const site_name = text(raw, 'site_name');
  const region_id = text(raw, 'region_id');
  const cluster_id = optionalText(raw, 'cluster_id');
  const county_id = optionalText(raw, 'county_id');
  const supervisor_id = optionalText(raw, 'supervisor_id');
  const latitude = optionalNumber(raw, 'latitude');
  const longitude = optionalNumber(raw, 'longitude');
  const geofence = optionalNumber(raw, 'geofence_radius_m');
  const status = (text(raw, 'status') || 'ACTIVE') as Enums<'site_status'>;

  if (!CODE_PATTERN.test(site_code)) errors.site_code = 'Site ID is required: letters, digits, ".", "-" or "_" (max 32).';
  if (site_name.length < 2 || site_name.length > 120) errors.site_name = 'Site name must be 2–120 characters.';
  if (!isUuid(region_id)) errors.region_id = 'Select a region.';
  if (cluster_id !== null && !isUuid(cluster_id)) errors.cluster_id = 'Invalid cluster.';
  if (county_id !== null && !isUuid(county_id)) errors.county_id = 'Invalid county.';
  if (supervisor_id !== null && !isUuid(supervisor_id)) errors.supervisor_id = 'Invalid supervisor.';
  if (latitude === undefined || (latitude !== null && (latitude < -90 || latitude > 90))) {
    errors.latitude = 'Latitude must be a number between -90 and 90.';
  }
  if (longitude === undefined || (longitude !== null && (longitude < -180 || longitude > 180))) {
    errors.longitude = 'Longitude must be a number between -180 and 180.';
  }
  if (!errors.latitude && !errors.longitude && (latitude === null) !== (longitude === null)) {
    errors.longitude = 'Enter both latitude and longitude, or neither.';
  }
  if (geofence === undefined || (geofence !== null && (!Number.isInteger(geofence) || geofence <= 0))) {
    errors.geofence_radius_m = 'Geofence radius must be a whole number of metres greater than 0.';
  }
  if (!SITE_STATUSES.includes(status)) errors.status = 'Invalid status.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      site_code,
      site_name,
      region_id,
      cluster_id,
      county_id,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      address: optionalText(raw, 'address'),
      site_type: optionalText(raw, 'site_type'),
      power_configuration: optionalText(raw, 'power_configuration'),
      generator_available: checkbox(raw, 'generator_available'),
      solar_available: checkbox(raw, 'solar_available'),
      battery_available: checkbox(raw, 'battery_available'),
      grid_available: checkbox(raw, 'grid_available'),
      status,
      supervisor_id,
      geofence_radius_m: geofence ?? null,
    },
  };
}

export interface InviteInput {
  email: string;
  full_name: string;
  role: Enums<'app_role'>;
  region_id: string | null;
}

const ROLES: readonly Enums<'app_role'>[] = [
  'super_admin',
  'regional_manager',
  'regional_supervisor',
  'technician',
  'maintenance',
  'viewer',
];

export function validateInvite(raw: RawInput): ValidationResult<InviteInput, keyof InviteInput> {
  const errors: FieldErrors<keyof InviteInput> = {};
  const email = text(raw, 'email').toLowerCase();
  const full_name = text(raw, 'full_name');
  const role = text(raw, 'role') as Enums<'app_role'>;
  const region_id = optionalText(raw, 'region_id');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) errors.email = 'Enter a valid email address.';
  if (full_name.length < 2 || full_name.length > 120) errors.full_name = 'Full name must be 2–120 characters.';
  if (!ROLES.includes(role)) errors.role = 'Select a role.';
  if (region_id !== null && !isUuid(region_id)) errors.region_id = 'Invalid region.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { email, full_name, role, region_id } };
}

import { z } from 'zod';

const uuid = z.uuid();
/** Codes: letters, digits, dot, dash, underscore; starts with a letter or digit. */
export const code = (max = 32) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^[A-Za-z0-9][A-Za-z0-9._-]{0,${max - 1}}$`), `use 1–${max} letters, digits, ".", "-" or "_"`);
const name = z.string().trim().min(1).max(120);
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));

export const RegionInput = z.strictObject({ code: code(), name, isActive: z.boolean().optional() });
export const RegionPatch = RegionInput.partial();
export const ClusterInput = z.strictObject({ regionId: uuid, code: code(), name, isActive: z.boolean().optional() });
export const ClusterPatch = z.strictObject({ code: code().optional(), name: name.optional(), isActive: z.boolean().optional() });
export const CountyInput = z.strictObject({ clusterId: uuid, code: code(), name, isActive: z.boolean().optional() });
export const CountyPatch = ClusterPatch;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

const siteFields = {
  siteCode: code(),
  siteName: name,
  /** The site's place in the hierarchy: the most specific level given decides the rest. */
  regionId: uuid.optional(),
  clusterId: uuid.nullish(),
  countyId: uuid.nullish(),
  latitude: latitude.nullish(),
  longitude: longitude.nullish(),
  address: optionalText(500),
  siteType: optionalText(50),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DECOMMISSIONED']).optional(),
  generatorAvailable: z.boolean().optional(),
  solarAvailable: z.boolean().optional(),
  gridAvailable: z.boolean().optional(),
  batteryConfiguration: optionalText(500),
  powerConfiguration: optionalText(500),
};

const coordinatesTogether = (v: { latitude?: number | null; longitude?: number | null }) =>
  (v.latitude === undefined) === (v.longitude === undefined) && (v.latitude === null) === (v.longitude === null);

export const SiteInput = z
  .strictObject(siteFields)
  .refine((v) => v.regionId || v.clusterId || v.countyId, { message: 'give the region, cluster or county', path: ['regionId'] })
  .refine(coordinatesTogether, { message: 'give latitude and longitude together', path: ['latitude'] });
export const SitePatch = z.strictObject(siteFields).partial().refine(coordinatesTogether, {
  message: 'give latitude and longitude together',
  path: ['latitude'],
});

export const SiteListQuery = z.strictObject({
  q: z.string().trim().max(100).optional(),
  regionId: uuid.optional(),
  clusterId: uuid.optional(),
  countyId: uuid.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DECOMMISSIONED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type RegionInput = z.infer<typeof RegionInput>;
export type ClusterInput = z.infer<typeof ClusterInput>;
export type CountyInput = z.infer<typeof CountyInput>;
export type SiteInput = z.infer<typeof SiteInput>;
export type SitePatch = z.infer<typeof SitePatch>;
export type SiteListQuery = z.infer<typeof SiteListQuery>;

/** Test data for the offline modules (a small template shaped like the API's). */
import { DatabaseSync } from 'node:sqlite';
import type { ChecklistItem, FieldPack, ReadingField, Section, Site, Template } from '../lib/api/types';
import type { SqlDb } from './sql';

export const USER = 'u-1';

const item = (id: string, sectionId: string, extra: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id,
  sectionId,
  code: id,
  prompt: `Question ${id}`,
  helpText: null,
  responseType: 'YES_NO_NA',
  options: [],
  allowNotApplicable: true,
  isRequired: true,
  unit: null,
  minValue: null,
  maxValue: null,
  isInteger: false,
  failureOnAnswer: 'NO',
  requiresPhotoOnFailure: true,
  requiresCommentOnFailure: true,
  photoOnAnswers: [],
  commentOnAnswers: [],
  photoInstructions: null,
  analyticsKey: null,
  isActive: true,
  ...extra,
});

const field = (id: string, sectionId: string, extra: Partial<ReadingField> = {}): ReadingField => ({
  id,
  sectionId,
  code: id,
  label: `Reading ${id}`,
  valueType: 'NUMBER',
  unit: 'V',
  isInteger: false,
  minValue: null,
  maxValue: null,
  options: [],
  isRequired: true,
  helpText: null,
  analyticsKey: null,
  isActive: true,
  ...extra,
});

const section = (id: string, code: string, sortOrder: number, extra: Partial<Section> = {}): Section => ({
  id,
  code,
  name: code,
  category: code,
  allowNotApplicable: true,
  sortOrder,
  isActive: true,
  requiresEquipment: null,
  items: [],
  readingFields: [],
  ...extra,
});

export const TEMPLATE: Template = {
  id: 't-1',
  code: 'STD',
  name: 'Standard PM',
  version: 1,
  status: 'ACTIVE',
  sections: [
    section('s-dc', 'DC', 1, {
      items: [item('i-clean', 's-dc')],
      readingFields: [field('f-volt', 's-dc', { analyticsKey: 'dc.voltage' }), field('f-min', 's-dc', { isRequired: false, analyticsKey: 'dc.min' })],
    }),
    section('s-gen', 'GENERATOR', 2, { requiresEquipment: 'GENERATOR', items: [item('i-oil', 's-gen')] }),
    section('s-bat', 'BATTERY', 3, { items: [] }),
  ],
};

export const SITE: Site = {
  id: 'site-1',
  siteCode: 'T-1',
  siteName: 'Test site',
  status: 'ACTIVE',
  latitude: '7',
  longitude: '-11',
  address: null,
  siteType: null,
  generatorAvailable: false,
  solarAvailable: false,
  gridAvailable: true,
  batteryConfiguration: null,
  powerConfiguration: null,
  batteryUnitCount: 2,
  geofenceRadiusM: null,
};

export const PACK: FieldPack = {
  generatedAt: '2026-09-20T07:00:00.000Z',
  userId: USER,
  settings: { geofence: { mode: 'WARN', radiusM: 100 }, pm: { requireSignature: true } },
  sites: [SITE],
  schedules: [
    {
      id: 'sch-1',
      siteId: SITE.id,
      status: 'SCHEDULED',
      priority: 'MEDIUM',
      frequency: 'MONTHLY',
      scheduledDate: '2026-09-20',
      dueDate: '2026-09-25',
      notes: null,
      technicianId: USER,
      site: { id: SITE.id, siteCode: SITE.siteCode, siteName: SITE.siteName },
      technician: { id: USER, fullName: 'Tech' },
      template: { id: TEMPLATE.id, code: TEMPLATE.code, name: TEMPLATE.name, version: 1 },
    },
  ],
  templates: [TEMPLATE],
  rules: [{ id: 'r-1', lhsKey: 'dc.min', operator: '<=', rhsKey: 'dc.voltage', message: 'Minimum above voltage', isActive: true }],
  visits: [],
  moreVisitIds: [],
};

/** Node's built-in SQLite behind the store's SQL interface. */
export function memoryDb(): SqlDb {
  const db = new DatabaseSync(':memory:');
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params = []) => {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    all: async <T>(sql: string, params: (string | number | null)[] = []) => db.prepare(sql).all(...params) as T[],
  };
}

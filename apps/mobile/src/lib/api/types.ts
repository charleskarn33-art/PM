/** Shapes returned by the IPT PM API (the subset the phone uses). */

export type Answer = 'YES' | 'NO' | 'NA';
export type ResponseType = 'YES_NO_NA' | 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTI_SELECT' | 'DATE' | 'DATETIME' | 'PHOTO';
export type PmStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED' | 'REJECTED' | 'OVERDUE' | 'CANCELLED';

export interface Site {
  id: string;
  siteCode: string;
  siteName: string;
  status: string;
  latitude: string | number | null;
  longitude: string | number | null;
  address: string | null;
  siteType: string | null;
  generatorAvailable: boolean;
  solarAvailable: boolean;
  gridAvailable: boolean;
  batteryConfiguration: string | null;
  powerConfiguration: string | null;
  batteryUnitCount: number | null;
  geofenceRadiusM: number | null;
  region?: { id?: string; code?: string; name: string } | null;
  cluster?: { name: string } | null;
  county?: { name: string } | null;
}

export interface Schedule {
  id: string;
  siteId: string;
  status: PmStatus;
  priority: string;
  frequency: string;
  scheduledDate: string;
  dueDate: string;
  notes: string | null;
  technicianId: string | null;
  site: { id: string; siteCode: string; siteName: string };
  technician: { id: string; fullName: string } | null;
  template: { id: string; code: string; name: string; version: number };
}

export interface VisitSummary {
  id: string;
  status: PmStatus;
  startedAt: string;
  completedAt: string | null;
  completionPct: number;
  failureCount: number;
  scheduleId: string | null;
  site: { id: string; siteCode: string; siteName: string };
  template: { name: string; version: number };
}

export interface ChecklistItem {
  id: string;
  sectionId: string;
  code: string;
  prompt: string;
  helpText: string | null;
  responseType: ResponseType;
  options: string[];
  allowNotApplicable: boolean;
  isRequired: boolean;
  unit: string | null;
  minValue: number | null;
  maxValue: number | null;
  isInteger: boolean;
  failureOnAnswer: 'YES' | 'NO' | null;
  requiresPhotoOnFailure: boolean;
  requiresCommentOnFailure: boolean;
  photoOnAnswers: Answer[];
  commentOnAnswers: Answer[];
  photoInstructions: string | null;
}

export interface ReadingField {
  id: string;
  sectionId: string;
  code: string;
  label: string;
  valueType: 'NUMBER' | 'TEXT' | 'SELECT';
  unit: string | null;
  isInteger: boolean;
  minValue: number | null;
  maxValue: number | null;
  options: string[];
  isRequired: boolean;
  helpText: string | null;
}

export interface Section {
  id: string;
  code: string;
  name: string;
  category: string;
  allowNotApplicable: boolean;
  items: ChecklistItem[];
  readingFields: ReadingField[];
}

export interface ResponseRow {
  checklistItemId: string;
  answer: Answer | null;
  numericValue: number | null;
  textValue: string | null;
  selectedOptions: string[] | null;
  dateValue: string | null;
  datetimeValue: string | null;
  comment: string | null;
  isFailure: boolean;
}

export interface ReadingRow {
  readingFieldId: string;
  numericValue: number | null;
  textValue: string | null;
}

export interface Photo {
  id: string;
  checklistItemId: string | null;
  caption: string | null;
  contentType: string;
  createdAt: string;
}

export type IssueKind = 'REQUIRED' | 'COMMENT_REQUIRED' | 'PHOTO_REQUIRED' | 'INCONSISTENT' | 'SIGNATURE_REQUIRED';

export interface VisitIssue {
  sectionCode: string;
  kind: IssueKind;
  refType: 'item' | 'reading' | 'rule' | 'battery_unit' | 'visit';
  refId: string;
  label: string;
}

export interface SectionProgress {
  code: string;
  name: string;
  required: number;
  done: number;
  failures: number;
  notApplicable: boolean;
}

export interface VisitDetail {
  id: string;
  status: PmStatus;
  startedAt: string;
  completedAt: string | null;
  completionPct: number;
  failureCount: number;
  notApplicableSections: string[];
  overallComments: string | null;
  reviewComments: string | null;
  technicianId: string;
  gpsStatus: string | null;
  gpsDistanceM: number | null;
  gpsRadiusM: number | null;
  site: { id: string; siteCode: string; siteName: string };
  template: { name: string; version: number };
  sections: Section[];
  responses: ResponseRow[];
  readings: ReadingRow[];
  photos: Photo[];
  progress: { completionPct: number; failureCount: number; sections: SectionProgress[] };
  issues: VisitIssue[];
  signature: { signedAt: string; signedName: string | null } | null;
  modules: {
    battery: { units: { unitNumber: number; voltageV: number; comment: string | null }[] } | null;
    dc: { dcPowerKw: number | null; totalPhaseCurrentA: number | null } | null;
  };
}

export interface Settings {
  geofence: { mode: 'WARN' | 'REQUIRE_REASON' | 'BLOCK'; radiusM: number };
  pm: { requireSignature: boolean };
}

/** Editable answer fields sent to PUT /visits/:id/answers. */
export type ResponsePatch = Partial<Pick<ResponseRow, 'answer' | 'numericValue' | 'textValue' | 'selectedOptions' | 'dateValue' | 'datetimeValue' | 'comment'>>;

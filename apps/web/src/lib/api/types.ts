/** Shapes returned by the IPT PM API (the parts the web uses). */

export type PmStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'APPROVED' | 'REJECTED' | 'OVERDUE' | 'CANCELLED';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type FailureStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'VERIFIED' | 'CLOSED';
export type ActionStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CLOSED';

export interface Ref {
  id: string;
  name: string;
  code?: string;
}
export interface Person {
  id: string;
  fullName: string;
}

export interface Region {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  clusters: (Ref & { code: string; isActive: boolean; regionId: string; counties: (Ref & { code: string; isActive: boolean; clusterId: string })[] })[];
}

export interface SiteOverview {
  technicians: Person[];
  supervisor: Person | null;
  lastPmAt: string | null;
  nextPm: { scheduleId: string; dueDate: string; status: PmStatus } | null;
  openFailures: number;
  openActions: number;
}

export interface Site {
  id: string;
  siteCode: string;
  siteName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED';
  regionId: string;
  clusterId: string | null;
  countyId: string | null;
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
  isDemo: boolean;
  region: { id?: string; name: string } | null;
  cluster: { id?: string; name: string } | null;
  county: { id?: string; name: string } | null;
  overview: SiteOverview;
}

export interface Assignment {
  id: string;
  role: 'TECHNICIAN' | 'SUPERVISOR';
  startDate: string;
  endDate: string | null;
  active: boolean;
  endReason: string | null;
  user: Person & { email: string };
}

export interface Schedule {
  id: string;
  siteId: string;
  status: PmStatus;
  priority: Severity;
  frequency: string;
  scheduledDate: string;
  dueDate: string;
  notes: string | null;
  seriesId: string | null;
  technicianId: string | null;
  cancelReason?: string | null;
  site: { id: string; siteCode: string; siteName: string; regionId: string };
  technician: Person | null;
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
  isDemo?: boolean;
  site: { id: string; siteCode: string; siteName: string };
  technician: Person;
  template: { name: string; version: number };
}

export interface FailureSummary {
  id: string;
  number: string;
  source: 'PM_CHECKLIST' | 'MANUAL';
  title: string;
  severity: Severity;
  status: FailureStatus;
  category: string | null;
  stillReported: boolean;
  detectedAt: string;
  visitId: string | null;
  site: { id: string; siteCode: string; siteName: string; regionId: string };
  reportedBy: Person | null;
  _count?: { actions: number };
}

export interface ActionSummary {
  id: string;
  number: string;
  title: string;
  priority: Severity;
  status: ActionStatus;
  dueDate: string | null;
  failureId: string;
  site: { id: string; siteCode: string; siteName: string; regionId: string };
  assignedTo: Person | null;
  failure: { id: string; number: string; title: string; severity: Severity; status: FailureStatus };
}

export interface TimelineEntry {
  id: string;
  kind: 'COMMENT' | 'STATUS' | 'SYSTEM';
  body: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
  correctiveActionId: string | null;
  author: Person | null;
}

export interface Attachment {
  id: string;
  kind: 'PHOTO' | 'DOCUMENT';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: string;
  correctiveActionId: string | null;
  uploadedBy: Person;
}

export interface UserSummary {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  employeeCode: string | null;
  isActive: boolean;
  roles: string[];
  lastLoginAt: string | null;
}

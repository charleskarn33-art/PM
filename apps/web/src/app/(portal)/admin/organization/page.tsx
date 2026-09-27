import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import type { Region } from '@/lib/api/types';
import { requirePermission } from '@/lib/auth';
import { OrgUnitForm } from './org-unit-form';

export const metadata: Metadata = { title: 'Organization' };

type Unit = { id: string; code: string; name: string; isActive: boolean; parentName?: string };

function UnitList({ kind, units }: { kind: 'region' | 'cluster' | 'county'; units: Unit[] }) {
  if (units.length === 0) return <p className="text-sm text-muted-foreground">None yet.</p>;
  return (
    <ul className="divide-y">
      {units.map((u) => (
        <li key={u.id} className="py-2">
          <details>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">{u.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{u.code}</span>
                {u.parentName ? <span className="ml-2 text-xs text-muted-foreground">· {u.parentName}</span> : null}
              </span>
              <span className="flex items-center gap-2">
                {u.isActive ? null : <Badge tone="neutral">Inactive</Badge>}
                <span className="text-xs text-info">Edit</span>
              </span>
            </summary>
            <div className="mt-3 rounded-lg bg-muted/40 p-3">
              <OrgUnitForm kind={kind} initial={u} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export default async function OrganizationPage() {
  const session = await requirePermission('org.manage');
  if (!session.isGlobal) notFound();
  const regions = await load<Region[]>('/org/hierarchy');
  const clusters = regions.flatMap((r) => r.clusters.map((c) => ({ ...c, parentName: r.name })));
  const counties = clusters.flatMap((c) => c.counties.map((k) => ({ ...k, parentName: `${c.name}, ${c.parentName}` })));
  const sections = [
    { kind: 'region' as const, title: 'Regions', description: 'Top level. Managers, supervisors and viewers are scoped by region.', units: regions, parents: undefined, parentLabel: undefined },
    { kind: 'cluster' as const, title: 'Clusters', description: 'Groups of counties within a region.', units: clusters, parents: regions.map((r) => ({ id: r.id, name: r.name })), parentLabel: 'Region' },
    { kind: 'county' as const, title: 'Counties', description: 'Counties within a cluster.', units: counties, parents: clusters.map((c) => ({ id: c.id, name: `${c.name} (${c.parentName})` })), parentLabel: 'Cluster' },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Organization" description="Region → Cluster → County → Site. Entries are deactivated rather than deleted so history is kept." />
      <div className="grid gap-6 xl:grid-cols-3">
        {sections.map((s) => (
          <Card key={s.kind}>
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
              <CardDescription>{s.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <UnitList kind={s.kind} units={s.units} />
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-2 text-sm font-medium">Add {s.kind}</p>
                {s.parents && s.parents.length === 0 ? <p className="text-sm text-muted-foreground">Create a {s.parentLabel?.toLowerCase()} first.</p> : <OrgUnitForm kind={s.kind} parents={s.parents} parentLabel={s.parentLabel} />}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

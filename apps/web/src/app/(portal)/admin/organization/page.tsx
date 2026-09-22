import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requireCapability } from '@/lib/auth';
import { loadClusters, loadCounties, loadRegions } from '@/lib/org-data';
import { createClient } from '@/lib/supabase/server';
import { OrgUnitForm } from './org-unit-form';

export const metadata: Metadata = { title: 'Organization' };

interface Unit {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  parent_id: string | null;
  parentName?: string;
}

function UnitList({
  kind,
  units,
  parents,
  parentLabel,
}: {
  kind: 'region' | 'cluster' | 'county';
  units: Unit[];
  parents?: { id: string; name: string }[];
  parentLabel?: string;
}) {
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
                {u.is_active ? null : <Badge tone="neutral">Inactive</Badge>}
                <span className="text-xs text-info">Edit</span>
              </span>
            </summary>
            <div className="mt-3 rounded-lg bg-muted/40 p-3">
              <OrgUnitForm kind={kind} initial={u} parents={parents} parentLabel={parentLabel} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export default async function OrganizationPage() {
  await requireCapability('manage_organization');
  const supabase = await createClient();
  const [regions, clusters, counties] = await Promise.all([loadRegions(supabase), loadClusters(supabase), loadCounties(supabase)]);
  const regionName = new Map(regions.map((r) => [r.id, r.name]));
  const clusterName = new Map(clusters.map((c) => [c.id, c.name]));
  const regionParents = regions.map((r) => ({ id: r.id, name: r.name }));
  const clusterParents = clusters.map((c) => ({ id: c.id, name: `${c.name} (${regionName.get(c.region_id) ?? '?'})` }));

  const sections = [
    {
      kind: 'region' as const,
      title: 'Regions',
      description: 'Top level of the hierarchy. Managers and supervisors are scoped by region.',
      units: regions.map((r) => ({ ...r, parent_id: null })),
      parents: undefined,
      parentLabel: undefined,
    },
    {
      kind: 'cluster' as const,
      title: 'Clusters',
      description: 'Groups of counties within a region.',
      units: clusters.map((c) => ({ ...c, parent_id: c.region_id, parentName: regionName.get(c.region_id) })),
      parents: regionParents,
      parentLabel: 'Region',
    },
    {
      kind: 'county' as const,
      title: 'Counties',
      description: 'Counties within a cluster. Sites belong to a county.',
      units: counties.map((c) => ({ ...c, parent_id: c.cluster_id, parentName: clusterName.get(c.cluster_id) })),
      parents: clusterParents,
      parentLabel: 'Cluster',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        description="Region → Cluster → County → Site. Items are deactivated rather than deleted so history is preserved."
      />
      <div className="grid gap-6 xl:grid-cols-3">
        {sections.map((s) => (
          <Card key={s.kind}>
            <CardHeader>
              <CardTitle>{s.title}</CardTitle>
              <CardDescription>{s.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <UnitList kind={s.kind} units={s.units} parents={s.parents} parentLabel={s.parentLabel} />
              <div className="rounded-lg border border-dashed p-3">
                <p className="mb-2 text-sm font-medium">Add {s.kind}</p>
                {s.parents && s.parents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Create a {s.parentLabel?.toLowerCase()} first.</p>
                ) : (
                  <OrgUnitForm kind={s.kind} parents={s.parents} parentLabel={s.parentLabel} />
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

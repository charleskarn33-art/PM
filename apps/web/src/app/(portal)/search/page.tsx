import { CORRECTIVE_ACTION_STATUS_TONE, FAILURE_STATUS_TONE, humanizeStatus, SEVERITY_TONE } from '@ipt/shared';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api/server';
import type { ActionStatus, FailureStatus, Severity } from '@/lib/api/types';
import { hasPermission, requireSession } from '@/lib/auth';

export const metadata: Metadata = { title: 'Search' };

interface Results {
  q: string;
  sites: { id: string; siteCode: string; siteName: string; status: string; region: { name: string } | null }[];
  failures: { id: string; number: string; title: string; status: FailureStatus; severity: Severity; site: { siteCode: string } }[];
  correctiveActions: { id: string; number: string; title: string; status: ActionStatus; site: { siteCode: string } }[];
  people: { id: string; fullName: string; email: string; isActive: boolean; roles: string[] }[];
}

/** One search box across sites, failures, corrective actions and people — only what the user may see. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireSession();
  const q = ((await searchParams).q ?? '').trim().slice(0, 100);
  const r = q.length >= 2 ? (await api<Results>(`/search?q=${encodeURIComponent(q)}`)).data : null;
  const total = r ? r.sites.length + r.failures.length + r.correctiveActions.length + r.people.length : 0;
  const peopleLink = hasPermission(session, 'users.manage');

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Search" description="Sites, failures (FL-…), corrective actions (CA-…) and people, within your scope." />
      <form method="get" role="search" className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={q} minLength={2} maxLength={100} placeholder="Site ID, name, FL-000012, a person…" className="pl-9" aria-label="Search" autoFocus />
        </div>
        <Button type="submit">Search</Button>
      </form>
      {q && q.length < 2 ? <p className="text-sm text-muted-foreground">Type at least 2 characters.</p> : null}
      {r && total === 0 ? <p className="text-sm text-muted-foreground">Nothing matches “{q}”.</p> : null}
      {r && r.sites.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sites</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {r.sites.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/sites/${s.id}`} className="hover:underline">
                    {s.siteCode} · {s.siteName}
                  </Link>
                  <span className="text-muted-foreground">{s.region?.name}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {r && r.failures.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Failures</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {r.failures.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/failures/${f.id}`} className="min-w-0 truncate hover:underline">
                    {f.number} · {f.site.siteCode} — {f.title}
                  </Link>
                  <span className="flex shrink-0 gap-1">
                    <StatusBadge status={f.severity} tone={SEVERITY_TONE[f.severity]} />
                    <StatusBadge status={f.status} tone={FAILURE_STATUS_TONE[f.status]} />
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {r && r.correctiveActions.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Corrective actions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {r.correctiveActions.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/corrective-actions/${a.id}`} className="min-w-0 truncate hover:underline">
                    {a.number} · {a.site.siteCode} — {a.title}
                  </Link>
                  <StatusBadge status={a.status} tone={CORRECTIVE_ACTION_STATUS_TONE[a.status]} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {r && r.people.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">People</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {r.people.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  {peopleLink ? (
                    <Link href={`/admin/users/${p.id}`} className="hover:underline">
                      {p.fullName}
                    </Link>
                  ) : (
                    <span>{p.fullName}</span>
                  )}
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {p.email}
                    {p.roles.map((role) => (
                      <Badge key={role} tone="outline">
                        {humanizeStatus(role)}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireCapability } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { activateTemplate, cloneTemplate } from './actions';

export const metadata: Metadata = { title: 'PM Templates' };

export default async function TemplatesPage() {
  await requireCapability('manage_templates');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('pm_templates')
    .select('id, code, name, version, status, updated_at, pm_sections(id, pm_checklist_items(id))')
    .order('code')
    .order('version', { ascending: false });
  if (error) throw new Error(`Unable to load templates: ${error.message}`);
  const templates = data ?? [];
  const latestByCode = new Map<string, number>();
  for (const t of templates) latestByCode.set(t.code, Math.max(latestByCode.get(t.code) ?? 0, t.version));

  return (
    <div className="space-y-6">
      <PageHeader
        title="PM Templates"
        description="The PM checklist is configuration, not code. Edit the active version for wording and rules; create a new version for structural changes. Retired versions stay read-only so historical PM records keep their meaning."
      />
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Template</TableHead>
            <TableHead>Version</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Sections</TableHead>
            <TableHead>Checklist items</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link href={`/admin/templates/${t.id}`} className="font-medium hover:underline">
                  {t.name}
                </Link>
                <div className="text-xs text-muted-foreground">{t.code}</div>
              </TableCell>
              <TableCell>v{t.version}</TableCell>
              <TableCell>
                <Badge tone={t.status === 'ACTIVE' ? 'success' : t.status === 'DRAFT' ? 'warning' : 'neutral'}>{t.status}</Badge>
              </TableCell>
              <TableCell>{t.pm_sections.length}</TableCell>
              <TableCell>{t.pm_sections.reduce((n, s) => n + s.pm_checklist_items.length, 0)}</TableCell>
              <TableCell className="whitespace-nowrap">{new Date(t.updated_at).toLocaleDateString('en-GB')}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  {t.status === 'DRAFT' ? (
                    <form action={activateTemplate}>
                      <input type="hidden" name="template_id" value={t.id} />
                      <Button type="submit" size="sm" variant="accent">
                        Activate
                      </Button>
                    </form>
                  ) : null}
                  {t.version === latestByCode.get(t.code) && t.status !== 'DRAFT' ? (
                    <form action={cloneTemplate}>
                      <input type="hidden" name="template_id" value={t.id} />
                      <Button type="submit" size="sm" variant="outline">
                        New version
                      </Button>
                    </form>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { load } from '@/lib/api/data';
import type { Region } from '@/lib/api/types';
import { requirePermission } from '@/lib/auth';
import { NewUserForm } from '../user-forms';

export const metadata: Metadata = { title: 'New user' };

export default async function NewUserPage() {
  const session = await requirePermission('users.manage');
  if (!session.isGlobal) notFound();
  const [roles, regions] = await Promise.all([load<{ code: string; name: string; description: string }[]>('/roles'), load<Region[]>('/org/hierarchy')]);
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="New user" description="Nobody signs up on their own: accounts are created here." />
      <Card>
        <CardContent className="pt-6">
          <NewUserForm roles={roles.map((r) => ({ id: r.code, label: r.name, description: r.description }))} regions={regions.map((r) => ({ id: r.id, label: r.name }))} />
        </CardContent>
      </Card>
    </div>
  );
}

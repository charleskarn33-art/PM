import { ROLE_LABELS } from '@ipt/shared';
import { PortalShell } from '@/components/layout/portal-shell';
import { requireSession } from '@/lib/auth';
import { navigationFor } from '@/lib/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  // Unread count for the header bell (legacy data source until notifications move to the API, Phase 12);
  // a failure here must not break the page.
  const count = await createClient()
    .then((supabase) => supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null))
    .then((r) => r.count)
    .catch(() => 0);
  return (
    <PortalShell
      sections={navigationFor(session.role)}
      userName={session.fullName || session.email}
      roleLabel={ROLE_LABELS[session.role]}
      unreadNotifications={count ?? 0}
    >
      {children}
    </PortalShell>
  );
}

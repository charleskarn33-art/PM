import { ROLE_LABELS } from '@ipt/shared';
import { PortalShell } from '@/components/layout/portal-shell';
import { requireSession } from '@/lib/auth';
import { navigationFor } from '@/lib/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const supabase = await createClient();
  // Unread count for the header bell; a failure here must not break the page.
  const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  return (
    <PortalShell
      sections={navigationFor(session.role)}
      userName={session.profile.full_name || session.email}
      roleLabel={ROLE_LABELS[session.role]}
      unreadNotifications={count ?? 0}
    >
      {children}
    </PortalShell>
  );
}

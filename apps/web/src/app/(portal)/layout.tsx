import { ROLE_LABELS } from '@ipt/shared';
import { PortalShell } from '@/components/layout/portal-shell';
import { requireSession } from '@/lib/auth';
import { navigationFor } from '@/lib/navigation';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <PortalShell
      sections={navigationFor(session.role)}
      userName={session.profile.full_name || session.email}
      roleLabel={ROLE_LABELS[session.role]}
    >
      {children}
    </PortalShell>
  );
}

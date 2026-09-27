import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/auth';
import { homeFor } from '@/lib/navigation';

/** The first page the signed-in user may open (the dashboard for office roles). */
export default async function Home() {
  const session = await requireSession();
  redirect(homeFor(session.permissions));
}

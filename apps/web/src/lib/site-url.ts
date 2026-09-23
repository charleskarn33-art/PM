import 'server-only';
import { headers } from 'next/headers';

/** Public base URL used in auth email links (SITE_URL, else the request host). */
export async function siteUrl(): Promise<string> {
  const configured = process.env.SITE_URL?.replace(/\/$/, '');
  if (configured) return configured;
  // Links in auth emails must not follow the request's Host header in production.
  if (process.env.NODE_ENV === 'production') throw new Error('SITE_URL must be set in production (see docs/SETUP.md).');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

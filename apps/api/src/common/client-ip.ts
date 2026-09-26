import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

export const FORWARD_KEY_HEADER = 'x-ipt-forward-key';
export const CLIENT_IP_HEADER = 'x-ipt-client-ip';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * The caller's IP address. Requests from the web app's server carry the
 * browser's address in X-IPT-Client-IP; it is believed only together with
 * the shared WEB_FORWARD_SECRET (so nobody else can choose their own IP to
 * dodge rate limits). Otherwise Express's req.ip (behind TRUST_PROXY_HOPS).
 */
export function clientIp(req: Pick<Request, 'ip' | 'headers'>, forwardSecret: string | null): string {
  const fallback = req.ip ?? 'unknown';
  if (!forwardSecret) return fallback;
  const key = req.headers[FORWARD_KEY_HEADER];
  const ip = req.headers[CLIENT_IP_HEADER];
  if (typeof key !== 'string' || typeof ip !== 'string' || !isIP(ip.trim())) return fallback;
  return timingSafeEqual(digest(key), digest(forwardSecret)) ? ip.trim() : fallback;
}

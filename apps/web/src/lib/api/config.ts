export interface ApiEnv {
  /** Base URL of the NestJS API, without `/api/v1`. */
  apiUrl: string;
  /** Shared with the API so it trusts the browser IP this server relays (optional). */
  forwardSecret: string | null;
  /** Cookies are marked Secure (and use the __Host- prefix) in production. */
  secureCookies: boolean;
}

/**
 * Server-side configuration for talking to the API. None of it is exposed to
 * the browser: the browser never calls the API directly and never sees tokens.
 */
export function readApiEnv(source: Record<string, string | undefined>): ApiEnv {
  const apiUrl = source.API_URL?.trim().replace(/\/+$/, '');
  if (!apiUrl) throw new Error('Missing environment variable API_URL (the API base URL, e.g. http://localhost:3001). See apps/web/.env.example.');
  let url: URL;
  try {
    url = new URL(apiUrl);
  } catch {
    throw new Error('API_URL is not a valid URL.');
  }
  const production = source.NODE_ENV === 'production';
  if (production && url.protocol !== 'https:' && !['localhost', '127.0.0.1', 'api'].includes(url.hostname)) {
    throw new Error('API_URL must use https:// in production (unless the API is on the same host or private network).');
  }
  const forwardSecret = source.WEB_FORWARD_SECRET?.trim() || null;
  if (forwardSecret && forwardSecret.length < 32) throw new Error('WEB_FORWARD_SECRET must be at least 32 characters.');
  return { apiUrl, forwardSecret, secureCookies: production };
}

export function apiEnv(): ApiEnv {
  return readApiEnv({ API_URL: process.env.API_URL, WEB_FORWARD_SECRET: process.env.WEB_FORWARD_SECRET, NODE_ENV: process.env.NODE_ENV });
}

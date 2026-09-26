const PUBLIC_PATHS = ['/login', '/forgot-password', '/api/health'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Only allow same-site relative redirects after login (prevents open redirects). */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  // Browsers drop tabs/newlines and treat "\" as "/" in URLs, so "/\t/evil" or
  // "/\\evil" would become "//evil" (another site). Refuse them outright.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  const base = 'http://same-site.invalid';
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base || isPublicPath(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

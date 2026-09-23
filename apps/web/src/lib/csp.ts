/**
 * Content-Security-Policy for every page. Scripts need the per-request nonce
 * (Next.js adds it to its own scripts); 'strict-dynamic' lets those load the
 * app's chunks. Styles allow inline attributes (charts and UI set them).
 * Images and API calls may go only to this site and the Supabase project.
 */
export function buildCsp({ nonce, supabaseUrl, dev }: { nonce: string; supabaseUrl: string; dev: boolean }): string {
  const supabase = new URL(supabaseUrl).origin;
  const realtime = supabase.replace(/^http/, 'ws');
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: ${supabase}`,
    `font-src 'self'`,
    `connect-src 'self' ${supabase} ${realtime}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (supabase.startsWith('https:')) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

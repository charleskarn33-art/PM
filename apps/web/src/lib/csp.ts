/**
 * Content-Security-Policy for every page. Scripts need the per-request nonce
 * (Next.js adds it to its own scripts); 'strict-dynamic' lets those load the
 * app's chunks. Styles allow inline attributes (charts and UI set them).
 * Images and connections may go only to this site — the browser never calls
 * the API directly — and, while legacy pages remain, the Supabase project
 * when one is configured.
 */
export function buildCsp({ nonce, supabaseUrl, dev }: { nonce: string; supabaseUrl?: string; dev: boolean }): string {
  let supabase = '';
  try {
    supabase = supabaseUrl ? new URL(supabaseUrl).origin : '';
  } catch {
    supabase = '';
  }
  const legacy = supabase ? ` ${supabase} ${supabase.replace(/^http/, 'ws')}` : '';
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:${supabase ? ` ${supabase}` : ''}`,
    `font-src 'self'`,
    `connect-src 'self'${legacy}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  if (!dev && (!supabase || supabase.startsWith('https:'))) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

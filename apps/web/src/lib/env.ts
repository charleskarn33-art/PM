/** Fails fast if a secret was misconfigured with a browser-visible prefix (NEXT_PUBLIC_*). */
export function assertNoPublicSecrets(source: Record<string, string | undefined>): void {
  const leaked = Object.keys(source).filter((k) => k.startsWith('NEXT_PUBLIC_') && /SECRET|SERVICE_ROLE|PASSWORD|TOKEN/i.test(k) && source[k]);
  if (leaked.length > 0) {
    throw new Error(`Secret keys must not use the NEXT_PUBLIC_ prefix: ${leaked.join(', ')}`);
  }
}

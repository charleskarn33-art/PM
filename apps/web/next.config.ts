import type { NextConfig } from 'next';
import { assertNoPublicSecrets } from './src/lib/env';

assertNoPublicSecrets(process.env);

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // The shared workspace package ships TypeScript source.
  transpilePackages: ['@ipt/shared'],
  // PDF rendering runs in Node route handlers; keep the renderer out of the bundle.
  serverExternalPackages: ['@react-pdf/renderer'],
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

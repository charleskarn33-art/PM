import { expect, test } from '@playwright/test';

test('the health check answers without sign-in and reports the Supabase connection', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toBe('no-store');
  const body = await res.json();
  expect(body).toMatchObject({ status: 'ok', supabase: 'ok' });
  expect(Object.keys(body).sort()).toEqual(['status', 'supabase', 'version']);
});

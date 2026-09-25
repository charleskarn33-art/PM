import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { startApp, testConfig } from './support.js';

describe('rate limiting', () => {
  it('answers 429 in the error envelope once the per-minute limit is reached (health is exempt)', async () => {
    const app = await startApp(testConfig({ RATE_LIMIT_PER_MINUTE: '3' }));
    try {
      const http = app.getHttpServer();
      for (let i = 0; i < 3; i += 1) await request(http).get('/api/v1/test-probe/me').expect(401);
      const res = await request(http).get('/api/v1/test-probe/me').expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
      await request(http).get('/api/v1/health').expect(200);
    } finally {
      await app.close();
    }
  });
});

describe('database outage', () => {
  it('readiness answers 503 when MySQL cannot be reached, liveness stays up', async () => {
    const app = await startApp(testConfig({ DATABASE_URL: 'mysql://nobody:nothing@127.0.0.1:1/ipt_pm_test?connectTimeout=500' }), false);
    try {
      const http = app.getHttpServer();
      const res = await request(http).get('/api/v1/health/ready').expect(503);
      expect(res.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', details: { checks: { database: { status: 'down' } } } });
      expect(JSON.stringify(res.body)).not.toMatch(/nobody|nothing|127\.0\.0\.1/);
      await request(http).get('/api/v1/health').expect(200);
    } finally {
      await app.close();
    }
  });
});

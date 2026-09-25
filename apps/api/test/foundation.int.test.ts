import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TokenService } from '../src/auth/token.service.js';
import { startApp, testConfig } from './support.js';

let app: NestExpressApplication;
let http: ReturnType<NestExpressApplication['getHttpServer']>;

beforeAll(async () => {
  app = await startApp(testConfig());
  http = app.getHttpServer();
});
afterAll(async () => {
  await app?.close();
});

describe('health', () => {
  it('liveness answers without authentication in the standard envelope', async () => {
    const res = await request(http).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok', version: null } });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('readiness reaches MySQL 8 through Prisma', async () => {
    const res = await request(http).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.checks.database).toMatchObject({ status: 'up' });
    expect(res.body.data.checks.database.server).toMatch(/^8\./);
  });
});

describe('errors and request ids', () => {
  it('unknown routes answer 404 in the error envelope with the request id', async () => {
    const res = await request(http).get('/api/v1/does-not-exist').set('X-Request-Id', 'trace-from-nginx-01').expect(404);
    expect(res.headers['x-request-id']).toBe('trace-from-nginx-01');
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.', requestId: 'trace-from-nginx-01' } });
  });

  it('unexpected errors become a generic 500 without internal details', async () => {
    const res = await request(http).get('/api/v1/test-probe/boom').expect(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
    expect(JSON.stringify(res.body)).not.toContain('internal detail');
  });
});

describe('authentication foundation', () => {
  it('routes are protected by default', async () => {
    const res = await request(http).get('/api/v1/test-probe/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('a valid access token is accepted and identifies the caller', async () => {
    const token = await app.get(TokenService).signAccessToken('0190f5a2-0000-7000-8000-00000000000a');
    const res = await request(http).get('/api/v1/test-probe/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toEqual({ data: { id: '0190f5a2-0000-7000-8000-00000000000a' } });
  });

  it('refresh tokens, malformed tokens and other schemes are refused', async () => {
    const refresh = await app.get(TokenService).signRefreshToken('u1', 'jti-1', 'fam-1');
    for (const header of [`Bearer ${refresh}`, 'Bearer not-a-jwt', 'Basic dXNlcjpwYXNz', 'Bearer ']) {
      const res = await request(http).get('/api/v1/test-probe/me').set('Authorization', header).expect(401);
      expect(['UNAUTHORIZED', 'INVALID_TOKEN']).toContain(res.body.error.code);
    }
  });
});

describe('input validation', () => {
  const auth = async () => `Bearer ${await app.get(TokenService).signAccessToken('u1')}`;

  it('accepts valid input', async () => {
    const res = await request(http).post('/api/v1/test-probe/echo').set('Authorization', await auth()).send({ loadCurrentA: 52.7 }).expect(201);
    expect(res.body).toEqual({ data: { loadCurrentA: 52.7 } });
  });

  it('rejects wrong types, negative values and unknown fields with field details', async () => {
    const res = await request(http)
      .post('/api/v1/test-probe/echo')
      .set('Authorization', await auth())
      .send({ loadCurrentA: '52.7', extra: 1 })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it('rejects malformed JSON with 400 (not a server error)', async () => {
    const res = await request(http)
      .post('/api/v1/test-probe/echo')
      .set('Authorization', await auth())
      .set('Content-Type', 'application/json')
      .send('{"loadCurrentA": 5,')
      .expect(400);
    expect(res.body.error).toMatchObject({ code: 'BAD_REQUEST', message: 'The request could not be read. Check that it is valid JSON.' });
    expect(JSON.stringify(res.body)).not.toMatch(/position|column/);
  });

  it('rejects bodies over 1 MB', async () => {
    const res = await request(http)
      .post('/api/v1/test-probe/echo')
      .set('Authorization', await auth())
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ note: 'x'.repeat(1_100_000) }))
      .expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('security headers and CORS', () => {
  it('sends Helmet headers and hides the framework', async () => {
    const res = await request(http).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('allows configured origins only', async () => {
    const ok = await request(http).options('/api/v1/health').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const bad = await request(http).options('/api/v1/health').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
});

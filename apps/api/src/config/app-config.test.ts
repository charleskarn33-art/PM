import { describe, expect, it } from 'vitest';
import { loadConfig } from './app-config.js';

const valid = {
  NODE_ENV: 'development',
  API_URL: 'http://localhost:3001',
  WEB_URL: 'http://localhost:3000',
  CORS_ORIGIN: 'http://localhost:3000, http://localhost:8081',
  DATABASE_URL: 'mysql://u:p@127.0.0.1:3306/ipt_pm',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  STORAGE_PATH: './storage',
  STORAGE_BASE_URL: 'http://localhost:3001/api/v1/files/',
};

describe('loadConfig', () => {
  it('parses a valid environment with defaults', () => {
    const c = loadConfig(valid);
    expect(c.port).toBe(3001);
    expect(c.corsOrigins).toEqual(['http://localhost:3000', 'http://localhost:8081']);
    expect(c.jwt.accessTtlSeconds).toBe(900);
    expect(c.storage).toEqual({ driver: 'local', path: './storage', baseUrl: 'http://localhost:3001/api/v1/files' });
    expect(c.version).toBeNull();
    expect(c.auth).toEqual({ maxFailedLogins: 5, lockoutMinutes: 15, rateLimitPerMinute: 10, refreshReuseGraceSeconds: 10 });
    expect(c.webForwardSecret).toBeNull();
    expect(c.orgTimezone).toBe('Africa/Monrovia');
    expect(c.photoMaxBytes).toBe(10_000_000);
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('rejects an unknown time zone', () => {
    expect(() => loadConfig({ ...valid, ORG_TIMEZONE: 'Mars/Olympus' })).toThrow(/ORG_TIMEZONE: must be an IANA time zone/);
  });

  it('treats an empty web forward secret as unset and rejects a short one', () => {
    expect(loadConfig({ ...valid, WEB_FORWARD_SECRET: '' }).webForwardSecret).toBeNull();
    expect(loadConfig({ ...valid, WEB_FORWARD_SECRET: 'f'.repeat(40) }).webForwardSecret).toBe('f'.repeat(40));
    expect(() => loadConfig({ ...valid, WEB_FORWARD_SECRET: 'short' })).toThrow(/WEB_FORWARD_SECRET: .*at least 32/);
  });

  it('lists every problem by name and never echoes values', () => {
    const bad = { ...valid, JWT_SECRET: 'short-secret-value', DATABASE_URL: 'postgres://x', API_PORT: 'abc' };
    let message = '';
    try {
      loadConfig(bad);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/JWT_SECRET: .*at least 32/);
    expect(message).toMatch(/DATABASE_URL: must be a mysql/);
    expect(message).toMatch(/API_PORT/);
    expect(message).not.toContain('short-secret-value');
  });

  it('requires the two JWT secrets to differ', () => {
    expect(() => loadConfig({ ...valid, JWT_REFRESH_SECRET: valid.JWT_SECRET })).toThrow(/JWT_REFRESH_SECRET: must differ/);
  });

  it('requires https URLs and origins in production', () => {
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/API_URL: must use https/);
    const prod = loadConfig({
      ...valid,
      NODE_ENV: 'production',
      API_URL: 'https://api.example.com',
      WEB_URL: 'https://pm.example.com',
      CORS_ORIGIN: 'https://pm.example.com',
      STORAGE_BASE_URL: 'https://api.example.com/api/v1/files',
    });
    expect(prod.env).toBe('production');
  });

  it('rejects missing required variables', () => {
    expect(() => loadConfig({})).toThrow(/API_URL[\s\S]*DATABASE_URL[\s\S]*JWT_SECRET/);
  });
});

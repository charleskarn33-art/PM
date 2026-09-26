import { z } from 'zod';

const secret = (name: string) =>
  z.string({ error: `${name} is required` }).min(32, `${name} must be at least 32 characters (use a random value, e.g. openssl rand -base64 48)`);

const origins = z
  .string()
  .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
  .pipe(z.array(z.url()).min(1, 'at least one origin is required'));

/** Environment variables the API reads. Nothing else is read from process.env. */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    API_URL: z.url(),
    WEB_URL: z.url(),
    CORS_ORIGIN: origins,
    DATABASE_URL: z.string().regex(/^mysql:\/\/[^/]+\/\w+/, 'must be a mysql:// connection URL with a database name'),
    JWT_SECRET: secret('JWT_SECRET'),
    JWT_REFRESH_SECRET: secret('JWT_REFRESH_SECRET'),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2_592_000),
    // Sign-in protection: the account locks for AUTH_LOCKOUT_MINUTES after this many consecutive failures.
    AUTH_MAX_FAILED_LOGINS: z.coerce.number().int().min(1).max(100).default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    // Stricter per-IP limit for the sign-in and token endpoints.
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    // A just-rotated refresh token is accepted again for this many seconds (parallel requests
    // from one browser or a retried mobile request); after that, reuse revokes the session. 0 = never.
    AUTH_REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
    // Shared secret the web app's server sends with the browser's IP address, so rate limits and
    // session records use the real client IP rather than the web server's. Optional.
    WEB_FORWARD_SECRET: z.preprocess((v) => (v === '' ? undefined : v), secret('WEB_FORWARD_SECRET').optional()),
    // The organisation's time zone: decides "today" for due dates and overdue PMs.
    ORG_TIMEZONE: z
      .string()
      .default('Africa/Monrovia')
      .refine((tz) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      }, 'must be an IANA time zone, e.g. Africa/Monrovia'),
    // Largest photo accepted (bytes).
    PHOTO_MAX_BYTES: z.coerce.number().int().min(100_000).max(25_000_000).default(10_000_000),
    STORAGE_DRIVER: z.enum(['local']).default('local'),
    STORAGE_PATH: z.string().min(1),
    STORAGE_BASE_URL: z.url(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
    // Number of reverse proxies (nginx) in front of the API, so client IPs are read correctly.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // Release identifier shown by the health endpoint (set by the Docker build).
    APP_VERSION: z.string().max(64).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.JWT_SECRET === e.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_SECRET' });
    }
    if (e.NODE_ENV === 'production') {
      for (const key of ['API_URL', 'WEB_URL', 'STORAGE_BASE_URL'] as const) {
        if (!e[key].startsWith('https://')) ctx.addIssue({ code: 'custom', path: [key], message: 'must use https:// in production' });
      }
      e.CORS_ORIGIN.forEach((o, i) => {
        if (!o.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['CORS_ORIGIN', i], message: 'must use https:// in production' });
      });
    }
  });

/** Validated, typed configuration, injected wherever settings are needed. */
export class AppConfig {
  readonly env!: 'development' | 'test' | 'production';
  readonly port!: number;
  readonly apiUrl!: string;
  readonly webUrl!: string;
  readonly corsOrigins!: string[];
  readonly databaseUrl!: string;
  readonly jwt!: { accessSecret: string; refreshSecret: string; accessTtlSeconds: number; refreshTtlSeconds: number };
  readonly auth!: { maxFailedLogins: number; lockoutMinutes: number; rateLimitPerMinute: number; refreshReuseGraceSeconds: number };
  readonly webForwardSecret!: string | null;
  readonly orgTimezone!: string;
  readonly photoMaxBytes!: number;
  readonly storage!: { driver: 'local'; path: string; baseUrl: string };
  readonly logLevel!: string;
  readonly rateLimitPerMinute!: number;
  readonly trustProxyHops!: number;
  readonly version!: string | null;
}

/**
 * Validates the environment. Throws one error listing every problem by
 * variable name — values are never included, so secrets cannot leak into logs.
 */
export function loadConfig(source: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid API configuration:\n${problems.join('\n')}`);
  }
  const e = parsed.data;
  return Object.freeze({
    env: e.NODE_ENV,
    port: e.API_PORT,
    apiUrl: e.API_URL.replace(/\/$/, ''),
    webUrl: e.WEB_URL.replace(/\/$/, ''),
    corsOrigins: e.CORS_ORIGIN,
    databaseUrl: e.DATABASE_URL,
    jwt: {
      accessSecret: e.JWT_SECRET,
      refreshSecret: e.JWT_REFRESH_SECRET,
      accessTtlSeconds: e.JWT_ACCESS_TTL,
      refreshTtlSeconds: e.JWT_REFRESH_TTL,
    },
    auth: {
      maxFailedLogins: e.AUTH_MAX_FAILED_LOGINS,
      lockoutMinutes: e.AUTH_LOCKOUT_MINUTES,
      rateLimitPerMinute: e.AUTH_RATE_LIMIT_PER_MINUTE,
      refreshReuseGraceSeconds: e.AUTH_REFRESH_REUSE_GRACE_SECONDS,
    },
    webForwardSecret: e.WEB_FORWARD_SECRET ?? null,
    orgTimezone: e.ORG_TIMEZONE,
    photoMaxBytes: e.PHOTO_MAX_BYTES,
    storage: { driver: e.STORAGE_DRIVER, path: e.STORAGE_PATH, baseUrl: e.STORAGE_BASE_URL.replace(/\/$/, '') },
    logLevel: e.LOG_LEVEL,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    version: e.APP_VERSION ?? null,
  }) as AppConfig;
}

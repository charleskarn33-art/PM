import { Body, Controller, Get, Module, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { CurrentUser, type AuthUser } from '../src/auth/auth-user.js';
import { Public } from '../src/auth/public.decorator.js';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe.js';
import { loadConfig, type AppConfig } from '../src/config/app-config.js';

/** Configuration for integration tests: the real loader, a disposable database. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see .env.example): integration tests need a MySQL test database.');
  return loadConfig({
    NODE_ENV: 'test',
    API_URL: 'http://localhost:3001',
    WEB_URL: 'http://localhost:3000',
    CORS_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: url,
    JWT_SECRET: `integration-access-${'x'.repeat(24)}`,
    JWT_REFRESH_SECRET: `integration-refresh-${'y'.repeat(24)}`,
    STORAGE_PATH: '/tmp/ipt-pm-test-storage',
    STORAGE_BASE_URL: 'http://localhost:3001/api/v1/files',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

const EchoBody = z.strictObject({ loadCurrentA: z.number().nonnegative(), note: z.string().max(20).optional() });

/** Test-only routes (never part of the production app). */
@Controller('test-probe')
class ProbeController {
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('echo')
  echo(@Body(new ZodValidationPipe(EchoBody)) body: z.infer<typeof EchoBody>) {
    return body;
  }

  @Public()
  @Get('boom')
  boom(): never {
    throw new Error('internal detail that must not leak');
  }
}

@Module({ controllers: [ProbeController] })
export class ProbeModule {}

export async function startApp(config: AppConfig, withProbe = true): Promise<NestExpressApplication> {
  const app = await createApp(config, withProbe ? [ProbeModule] : []);
  await app.init();
  return app;
}

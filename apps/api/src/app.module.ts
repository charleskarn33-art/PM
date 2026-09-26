import { Module, type DynamicModule, type ExecutionContext } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import type { Request } from 'express';
import type { IncomingMessage } from 'node:http';
import { AssignmentsModule } from './assignments/assignments.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AuthzModule } from './authz/authz.module.js';
import { AUTH_THROTTLE } from './authz/decorators.js';
import { clientIp } from './common/client-ip.js';
import { HttpExceptionFilter } from './common/http-exception.filter.js';
import { logRedactPaths, logSerializers, pathOf } from './common/logging.js';
import { requestId } from './common/request-id.js';
import { ResponseEnvelopeInterceptor } from './common/response.interceptor.js';
import type { AppConfig } from './config/app-config.js';
import { ConfigModule } from './config/config.module.js';
import { HealthModule } from './health/health.module.js';
import { OrganisationModule } from './organisation/organisation.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, extra: DynamicModule['imports'] = []): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            genReqId: requestId,
            // Never log credentials: headers are not serialised at all, and these are censored if ever added.
            redact: { paths: logRedactPaths, censor: '[redacted]' },
            serializers: logSerializers,
            customProps: (req: IncomingMessage & { user?: { id: string } }) => (req.user ? { userId: req.user.id } : {}),
            autoLogging: { ignore: (req: IncomingMessage) => pathOf(req.url) === '/api/v1/health' },
            ...(config.env === 'development' ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
          },
        }),
        ThrottlerModule.forRoot({
          // Per client IP (the browser's, for requests relayed by the web app's server).
          getTracker: (req: Record<string, unknown>) => clientIp(req as unknown as Request, config.webForwardSecret),
          throttlers: [
            { name: 'default', ttl: 60_000, limit: config.rateLimitPerMinute },
            // Stricter per-IP limit, only on routes marked @AuthThrottle (sign-in, refresh, password change).
            {
              name: 'auth',
              ttl: 60_000,
              limit: config.auth.rateLimitPerMinute,
              skipIf: (ctx: ExecutionContext) => !Reflect.getMetadata(AUTH_THROTTLE, ctx.getHandler()),
            },
          ],
        }),
        PrismaModule,
        AuthModule,
        AuthzModule,
        HealthModule,
        OrganisationModule,
        UsersModule,
        AssignmentsModule,
        ...extra,
      ],
      providers: [
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
        // Order matters: rate limiting runs before authentication.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: JwtAuthGuard },
      ],
    };
  }
}

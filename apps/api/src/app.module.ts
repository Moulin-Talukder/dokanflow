import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { resolveRequestId } from './common/request-id.js';
import { AppConfigModule } from './config/config.module.js';
import type { ApiEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { StaffModule } from './staff/staff.module.js';
import { TenantsModule } from './tenants/tenants.module.js';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            genReqId: resolveRequestId,
            redact: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            // Probes hit health endpoints constantly; don't flood the logs with them.
            autoLogging: { ignore: (req) => req.url?.startsWith('/api/health') ?? false },
            ...(env.NODE_ENV === 'development'
              ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
              : {}),
          },
        }),
        InfraModule,
        RateLimitModule,
        AuthModule,
        HealthModule,
        TenantsModule,
        StaffModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
    };
  }
}

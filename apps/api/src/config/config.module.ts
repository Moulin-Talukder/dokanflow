import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { ApiEnv } from './env.js';

/** Injection token for the validated environment. Use with @Inject(APP_CONFIG). */
export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class AppConfigModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: Object.freeze(env) }],
      exports: [APP_CONFIG],
    };
  }
}

import { Global, Module } from '@nestjs/common';
import { RATE_LIMIT_STORE, RateLimitGuard } from './rate-limit.guard.js';
import { RedisRateLimitStore } from './rate-limit.store.js';

@Global()
@Module({
  providers: [{ provide: RATE_LIMIT_STORE, useClass: RedisRateLimitStore }, RateLimitGuard],
  exports: [RATE_LIMIT_STORE, RateLimitGuard],
})
export class RateLimitModule {}

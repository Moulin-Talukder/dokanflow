import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';

/** Shared Redis connection for caching and rate limiting (used from Phase 7). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private lastErrorLoggedAt = 0;
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: ApiEnv) {
    this.client = new Redis(config.REDIS_URL, {
      connectionName: 'dokanflow-api',
      // Fail fast while disconnected instead of queueing commands, so request
      // latency stays bounded and health checks report the outage.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5_000,
    });
    // ioredis reconnects on its own. Log failures at most every 30s to avoid log floods.
    this.client.on('error', (error: Error) => {
      const now = Date.now();
      if (now - this.lastErrorLoggedAt > 30_000) {
        this.lastErrorLoggedAt = now;
        this.logger.warn(`Redis connection error: ${error.message}`);
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => {
      this.client.disconnect();
    });
  }

  async ping(): Promise<void> {
    await this.client.ping();
  }
}

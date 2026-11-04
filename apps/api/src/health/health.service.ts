import { Injectable, Logger } from '@nestjs/common';
import type { DependencyCheck, ReadinessResponse } from '@dokanflow/shared';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';

export const DEPENDENCY_TIMEOUT_MS = 2_000;

class DependencyTimeoutError extends Error {
  constructor() {
    super('timeout');
  }
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async readiness(): Promise<ReadinessResponse> {
    const [database, redis] = await Promise.all([
      this.check('database', () => this.prisma.ping()),
      this.check('redis', () => this.redis.ping()),
    ]);
    const healthy = database.status === 'up' && redis.status === 'up';
    return {
      status: healthy ? 'ok' : 'error',
      checks: { database, redis },
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async check(name: string, probe: () => Promise<void>): Promise<DependencyCheck> {
    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new DependencyTimeoutError());
          }, DEPENDENCY_TIMEOUT_MS);
        }),
      ]);
      return { status: 'up', latencyMs: elapsedMs(startedAt) };
    } catch (error) {
      // Details stay in the server log. The public response only says what kind of failure.
      this.logger.warn({ err: error }, `Health check failed: ${name}`);
      return {
        status: 'down',
        latencyMs: elapsedMs(startedAt),
        error: error instanceof DependencyTimeoutError ? 'timeout' : 'unavailable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

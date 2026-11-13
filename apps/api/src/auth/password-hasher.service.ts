import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ApiHttpException } from '../common/api-http.exception.js';
import {
  ConcurrencyLimiter,
  ConcurrencyLimitExceededError,
} from '../common/concurrency-limiter.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { ApiEnv } from '../config/env.js';
import { getDummyPasswordHash, hashPassword, verifyPassword } from './password-hasher.js';

/**
 * All Argon2 work goes through here. Each hash uses ~19 MiB, so a limiter caps how
 * many run at once and how many may wait; beyond that requests get 503 at once
 * instead of piling up and exhausting memory.
 */
@Injectable()
export class PasswordHasher implements OnModuleInit {
  private readonly limiter: ConcurrencyLimiter;
  private dummyHash: string | undefined;

  constructor(@Inject(APP_CONFIG) config: ApiEnv) {
    this.limiter = new ConcurrencyLimiter(
      config.PASSWORD_HASH_CONCURRENCY,
      config.PASSWORD_HASH_QUEUE,
    );
  }

  /** Computes the decoy hash at startup, so the first unknown-user login is not slower. */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await getDummyPasswordHash();
  }

  hash(password: string): Promise<string> {
    return this.limited(() => hashPassword(password));
  }

  verify(password: string, encoded: string): Promise<boolean> {
    return this.limited(() => verifyPassword(password, encoded));
  }

  /**
   * Verifies against a real hash nobody knows. Used when the user does not exist,
   * so unknown users and wrong passwords take the same time.
   */
  verifyDummy(password: string): Promise<boolean> {
    return this.limited(async () =>
      verifyPassword(password, this.dummyHash ?? (await getDummyPasswordHash())),
    );
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await this.limiter.run(task);
    } catch (error) {
      if (error instanceof ConcurrencyLimitExceededError) {
        throw new ApiHttpException(503, 'SERVICE_UNAVAILABLE', 'Server busy, try again shortly');
      }
      throw error;
    }
  }
}

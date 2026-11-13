import { Injectable } from '@nestjs/common';
import { RedisService } from '../infra/redis.service.js';

export interface HitResult {
  /** Hits in the current window, including this one. */
  count: number;
  /** Milliseconds until the window resets. */
  ttlMs: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<HitResult>;
}

/** Increment and start the window atomically, so concurrent requests cannot both "win". */
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

@Injectable()
export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisService) {}

  async hit(key: string, windowMs: number): Promise<HitResult> {
    const result: unknown = await this.redis.client.eval(HIT_SCRIPT, 1, key, String(windowMs));
    if (!Array.isArray(result) || typeof result[0] !== 'number' || typeof result[1] !== 'number') {
      throw new Error('Unexpected rate-limit script result');
    }
    return { count: result[0], ttlMs: result[1] };
  }
}

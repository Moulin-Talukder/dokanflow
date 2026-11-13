export class ConcurrencyLimitExceededError extends Error {
  constructor() {
    super('Too many operations waiting');
    this.name = 'ConcurrencyLimitExceededError';
  }
}

/**
 * Runs at most `maxConcurrent` tasks at once and queues up to `maxQueued` more.
 * Anything beyond that is rejected immediately, so memory stays bounded under
 * load instead of growing with the number of waiting requests.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    readonly maxConcurrent: number,
    readonly maxQueued: number,
  ) {
    if (maxConcurrent < 1 || maxQueued < 0) {
      throw new RangeError('maxConcurrent must be >= 1 and maxQueued >= 0');
    }
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiting.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueued) {
      return Promise.reject(new ConcurrencyLimitExceededError());
    }
    // The slot is handed over directly by release(), so `active` stays unchanged.
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}

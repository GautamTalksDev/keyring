/**
 * Simple async rate limiter for MCP tool calls (token bucket).
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async removeToken(signal?: AbortSignal): Promise<void> {
    for (;;) {
      signal?.throwIfAborted();
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await sleep(50, signal);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerSecond);
    this.lastRefill = now;
  }
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Retry helper for 429 / transient MCP failures.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    signal?: AbortSignal;
    isRetryable?: (error: unknown) => boolean;
    retryAfterMs?: (error: unknown, attempt: number) => number;
  } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const isRetryable =
    opts.isRetryable ??
    ((error: unknown) => {
      if (error && typeof error === "object" && "status" in error) {
        const status = (error as { status?: number }).status;
        return status === 429 || status === 502 || status === 503;
      }
      return false;
    });
  const retryAfterMs =
    opts.retryAfterMs ??
    ((_e, attempt) => Math.min(8_000, 250 * 2 ** attempt));

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isRetryable(error)) throw error;
      await sleep(retryAfterMs(error, attempt), opts.signal);
    }
  }
  throw lastError;
}

const RETRYABLE_PATTERN =
  /RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|INTERNAL|ABORTED|\b429\b|\b5\d\d\b|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|fetch failed/i;

export function isRetryableError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return RETRYABLE_PATTERN.test(msg);
}

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt > opts.retries || !isRetryableError(e)) throw e;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

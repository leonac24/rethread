// Exponential backoff retry for transient network failures.
// Only retries on network errors or 429/5xx responses — never on 4xx client errors.
//
// Usage:
//   const data = await withRetry(() => fetch(...).then(r => r.json()), { retries: 3 });

import { log } from '@/lib/logger';

export type RetryOptions = {
  /** Max number of attempts (including the first). Default: 3 */
  retries?: number;
  /** Base delay in ms before first retry. Doubles each attempt. Default: 300 */
  baseDelayMs?: number;
  /** Max delay cap in ms. Default: 5000 */
  maxDelayMs?: number;
  /** Label for log output (e.g. 'Gemini', 'BigQuery'). Default: 'request' */
  label?: string;
};

// HTTP status codes that are safe to retry
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  // ±20% jitter to avoid thundering herd
  return ms * (0.8 + Math.random() * 0.4);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { retries = 3, baseDelayMs = 300, maxDelayMs = 5000, label = 'request' } = options;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const isRetryable =
        // Network-level failures (fetch throws, not HTTP errors)
        !(err instanceof HttpError) ||
        // Retryable HTTP status codes
        RETRYABLE_STATUSES.has((err as HttpError).status);

      if (!isRetryable || attempt === retries) {
        throw err;
      }

      const backoff = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const wait = Math.round(jitter(backoff));

      log.warn(`${label} attempt ${attempt}/${retries} failed, retrying in ${wait}ms`, {
        stage: 'retry',
        attempt,
        err: err instanceof Error ? err.message : String(err),
      });

      await delay(wait);
    }
  }

  throw lastErr;
}

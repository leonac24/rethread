import { describe, it, expect } from 'bun:test';
import { withRetry, HttpError } from '../../lib/retry';

// Speed up tests — override delay by passing tiny baseDelayMs
const FAST: import('../../lib/retry').RetryOptions = { baseDelayMs: 1, maxDelayMs: 5 };

describe('withRetry', () => {
  it('returns the result immediately when fn succeeds on first attempt', async () => {
    const result = await withRetry(() => Promise.resolve(42), FAST);
    expect(result).toBe(42);
  });

  it('retries on network error and succeeds on second attempt', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw new Error('Network error');
      return 'ok';
    }, { ...FAST, retries: 3 });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('throws after exhausting all retries', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new Error('always fails');
      }, { ...FAST, retries: 3 }),
    ).rejects.toThrow('always fails');
    expect(calls).toBe(3);
  });

  it('retries on 429 HttpError', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 2) throw new HttpError(429, 'rate limited');
      return 'recovered';
    }, { ...FAST, retries: 3 });
    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  });

  it('retries on 503 HttpError', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(503, 'unavailable');
      }, { ...FAST, retries: 2 }),
    ).rejects.toThrow('unavailable');
    expect(calls).toBe(2);
  });

  it('does NOT retry on 400 HttpError (client error)', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(400, 'bad request');
      }, { ...FAST, retries: 3 }),
    ).rejects.toThrow('bad request');
    // Should fail immediately — no retry on 4xx
    expect(calls).toBe(1);
  });

  it('does NOT retry on 401 HttpError', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(401, 'unauthorized');
      }, { ...FAST, retries: 3 }),
    ).rejects.toThrow('unauthorized');
    expect(calls).toBe(1);
  });

  it('does NOT retry on 404 HttpError', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => {
        calls++;
        throw new HttpError(404, 'not found');
      }, { ...FAST, retries: 3 }),
    ).rejects.toThrow('not found');
    expect(calls).toBe(1);
  });
});

describe('HttpError', () => {
  it('exposes status code', () => {
    const err = new HttpError(503, 'service unavailable');
    expect(err.status).toBe(503);
    expect(err.message).toBe('service unavailable');
    expect(err.name).toBe('HttpError');
  });

  it('is an instance of Error', () => {
    expect(new HttpError(500, 'err')).toBeInstanceOf(Error);
  });
});

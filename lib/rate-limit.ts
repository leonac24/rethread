// Shared IP-based rate limiter — imported by every API route that needs limiting.
// State lives in Redis so the window holds across serverless instances and cold starts.

import { RATE_LIMIT, RATE_WINDOW_MS } from '@/lib/config';
import { redis } from '@/lib/redis';
import { log } from '@/lib/logger';

// Fixed window: INCR and set the expiry atomically so a key can never be left without a TTL.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

export async function checkRateLimit(ip: string): Promise<{ allowed: boolean; retryAfter?: number }> {
  try {
    const [count, ttlMs] = await redis().eval<[number], [number, number]>(
      HIT_SCRIPT, [`rl:${ip}`], [RATE_WINDOW_MS],
    );
    if (count <= RATE_LIMIT) return { allowed: true };
    return { allowed: false, retryAfter: Math.max(1, Math.ceil(ttlMs / 1000)) };
  } catch (err) {
    // Fail open: a Redis outage should not take every API route down with it.
    log.warn('Rate limit check failed, allowing request', { err: (err as Error).message });
    return { allowed: true };
  }
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    'unknown'
  );
}

// Shared IP-based rate limiter — imported by every API route that needs limiting.
// Using a single module-level Map means all routes share the same window state
// within a process rather than each route tracking IPs independently.

import { RATE_LIMIT, RATE_WINDOW_MS, MAX_TRACKED_IPS } from '@/lib/config';

const ipHits = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  // Evict all expired entries if the Map is at capacity
  if (ipHits.size >= MAX_TRACKED_IPS) {
    for (const [key, entry] of ipHits) {
      if (now > entry.resetAt) ipHits.delete(key);
    }
  }

  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    const resetAt = now + RATE_WINDOW_MS;
    ipHits.set(ip, { count: 1, resetAt });
    // Auto-evict this entry once the window expires
    setTimeout(() => {
      const current = ipHits.get(ip);
      if (current?.resetAt === resetAt) ipHits.delete(ip);
    }, RATE_WINDOW_MS);
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { allowed: true };
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    'unknown'
  );
}

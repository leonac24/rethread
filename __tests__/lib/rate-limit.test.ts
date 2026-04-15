import { describe, it, expect, beforeEach } from 'bun:test';

// Re-import fresh module state for each test by clearing the module cache.
// rate-limit.ts holds module-level state (ipHits Map) so we must reset between tests.
let checkRateLimit: (ip: string) => { allowed: boolean; retryAfter?: number };
let getClientIp: (req: Request) => string;

beforeEach(async () => {
  // Force a fresh module import to reset ipHits Map state
  const mod = await import(`../../lib/rate-limit?t=${Date.now()}`);
  checkRateLimit = mod.checkRateLimit;
  getClientIp = mod.getClientIp;
});

describe('checkRateLimit', () => {
  it('allows first request from a new IP', () => {
    const result = checkRateLimit('1.2.3.4');
    expect(result.allowed).toBe(true);
  });

  it('allows requests up to the limit', () => {
    const ip = '10.0.0.1';
    // RATE_LIMIT is 5 — first 5 should all be allowed
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip).allowed).toBe(true);
    }
  });

  it('blocks the 6th request within the window', () => {
    const ip = '10.0.0.2';
    for (let i = 0; i < 5; i++) checkRateLimit(ip);
    const result = checkRateLimit(ip);
    expect(result.allowed).toBe(false);
  });

  it('returns a positive retryAfter when blocked', () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 5; i++) checkRateLimit(ip);
    const result = checkRateLimit(ip);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it('treats different IPs independently', () => {
    const ipA = '192.168.1.1';
    const ipB = '192.168.1.2';
    for (let i = 0; i < 5; i++) checkRateLimit(ipA);
    // ipA is blocked but ipB should still be allowed
    expect(checkRateLimit(ipA).allowed).toBe(false);
    expect(checkRateLimit(ipB).allowed).toBe(true);
  });
});

describe('getClientIp', () => {
  it('prefers x-real-ip header', () => {
    const req = new Request('http://localhost/api/test', {
      headers: { 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' },
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to last x-forwarded-for entry', () => {
    const req = new Request('http://localhost/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' },
    });
    expect(getClientIp(req)).toBe('10.0.0.2');
  });

  it('returns "unknown" when no IP headers present', () => {
    const req = new Request('http://localhost/api/test');
    expect(getClientIp(req)).toBe('unknown');
  });
});

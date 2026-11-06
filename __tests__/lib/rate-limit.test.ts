import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { createFakeRedis } from '../helpers/fake-redis';

let fake = createFakeRedis();
mock.module('../../lib/redis', () => ({ redis: () => fake }));
mock.module('../../lib/logger', () => ({ log: { info() {}, warn() {}, error() {} } }));

const { checkRateLimit, getClientIp } = await import('../../lib/rate-limit?real'); // query bypasses other files' mock.module of rate-limit

beforeEach(() => {
  fake = createFakeRedis();
});

describe('checkRateLimit', () => {
  it('allows first request from a new IP', async () => {
    const result = await checkRateLimit('1.2.3.4');
    expect(result.allowed).toBe(true);
  });

  it('allows requests up to the limit', async () => {
    const ip = '10.0.0.1';
    // RATE_LIMIT is 5 — first 5 should all be allowed
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit(ip)).allowed).toBe(true);
    }
  });

  it('blocks the 6th request within the window', async () => {
    const ip = '10.0.0.2';
    for (let i = 0; i < 5; i++) await checkRateLimit(ip);
    const result = await checkRateLimit(ip);
    expect(result.allowed).toBe(false);
  });

  it('returns a positive retryAfter when blocked', async () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 5; i++) await checkRateLimit(ip);
    const result = await checkRateLimit(ip);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(60);
  });

  it('treats different IPs independently', async () => {
    const ipA = '192.168.1.1';
    const ipB = '192.168.1.2';
    for (let i = 0; i < 5; i++) await checkRateLimit(ipA);
    // ipA is blocked but ipB should still be allowed
    expect((await checkRateLimit(ipA)).allowed).toBe(false);
    expect((await checkRateLimit(ipB)).allowed).toBe(true);
  });
});

describe('checkRateLimit when Redis is down', () => {
  it('fails open', async () => {
    fake.eval = async () => { throw new Error('ECONNREFUSED'); };
    expect((await checkRateLimit('10.0.0.9')).allowed).toBe(true);
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

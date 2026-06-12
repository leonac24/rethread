import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing routes ────────────────────────────────

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request) => null as unknown);

// Referrals collection — supports .where().get() query
const mockReferralsQueryGet = mock(async () => ({ docs: [] as unknown[] }));
const mockReferralsWhere = mock(() => ({ get: mockReferralsQueryGet }));

// Partners collection — doc().get()
const mockPartnerGet = mock(async () => ({
  exists: true,
  data: () => ({ status: 'verified' }),
}));
const mockPartnerDoc = mock(() => ({ get: mockPartnerGet }));

const mockCollection = mock((name: string) => {
  if (name === 'partners') return { doc: mockPartnerDoc };
  // referrals — supports where().get()
  return { where: mockReferralsWhere };
});
const mockDb = mock(() => ({ collection: mockCollection }));

mock.module('../../lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
mock.module('../../lib/firebase/verify-token', () => ({
  verifyBearerToken: mockVerifyBearerToken,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));

const { GET } = await import('../../app/api/partners/stats/route');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest() {
  return new Request('http://localhost/api/partners/stats', { method: 'GET' });
}

function makeTimestamp(ms: number) {
  return { toMillis: () => ms };
}

function monthKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Build a mock referral doc
function referralDoc(status: string, createdAtMs?: number | null) {
  return {
    data: () => ({
      status,
      createdAt: createdAtMs != null ? makeTimestamp(createdAtMs) : null,
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/partners/stats', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'partner-uid-1', email: 'p@biz.com' }));
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ status: 'verified' }),
    }));
    mockReferralsQueryGet.mockImplementation(async () => ({ docs: [] }));
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: false, retryAfter: 30 }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('returns 401 when no bearer token', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Authentication/);
  });

  it('returns 404 when partner doc does not exist', async () => {
    mockPartnerGet.mockImplementation(async () => ({ exists: false, data: () => null }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/No application found/);
  });

  it('returns zeros with no referral docs', async () => {
    mockReferralsQueryGet.mockImplementation(async () => ({ docs: [] }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issued).toBe(0);
    expect(body.redeemed).toBe(0);
    expect(body.conversionPct).toBe(0);
    expect(body.estimatedOwed).toBe(0);
    expect(body.status).toBe('verified');
    expect(Array.isArray(body.monthly)).toBe(true);
    expect(body.monthly).toHaveLength(6);
  });

  it('correctly aggregates issued and redeemed counts', async () => {
    const now = Date.now();
    mockReferralsQueryGet.mockImplementation(async () => ({
      docs: [
        referralDoc('issued', now),
        referralDoc('issued', now),
        referralDoc('redeemed', now),
        referralDoc('redeemed', now),
        referralDoc('redeemed', now),
      ],
    }));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.issued).toBe(5);
    expect(body.redeemed).toBe(3);
    expect(body.conversionPct).toBe(60);
    expect(body.estimatedOwed).toBeCloseTo(2.25, 2);
  });

  it('computes estimatedOwed correctly at $0.75 per redemption', async () => {
    const now = Date.now();
    mockReferralsQueryGet.mockImplementation(async () => ({
      docs: [
        referralDoc('redeemed', now),
        referralDoc('redeemed', now),
      ],
    }));
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.estimatedOwed).toBe(1.50);
  });

  it('buckets docs into correct monthly slots', async () => {
    const now = new Date();
    // Current month timestamp
    const thisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15);
    // Two months ago
    const twoMonthsAgo = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 10);

    mockReferralsQueryGet.mockImplementation(async () => ({
      docs: [
        referralDoc('issued', thisMonth),
        referralDoc('redeemed', thisMonth),
        referralDoc('issued', twoMonthsAgo),
      ],
    }));

    const res = await GET(makeRequest());
    const body = await res.json();

    const thisMonthKey = monthKey(thisMonth);
    const twoAgoKey = monthKey(twoMonthsAgo);

    const thisMonthBucket = body.monthly.find((m: { month: string }) => m.month === thisMonthKey);
    const twoAgoBucket = body.monthly.find((m: { month: string }) => m.month === twoAgoKey);

    expect(thisMonthBucket).toBeDefined();
    expect(thisMonthBucket.issued).toBe(2);
    expect(thisMonthBucket.redeemed).toBe(1);

    expect(twoAgoBucket).toBeDefined();
    expect(twoAgoBucket.issued).toBe(1);
    expect(twoAgoBucket.redeemed).toBe(0);
  });

  it('counts malformed createdAt doc in totals but not monthly buckets', async () => {
    const now = Date.now();
    mockReferralsQueryGet.mockImplementation(async () => ({
      docs: [
        referralDoc('issued', now),         // valid — appears in monthly
        referralDoc('redeemed', null),      // null createdAt — totals only
        referralDoc('issued', null),        // null createdAt — totals only
      ],
    }));

    const res = await GET(makeRequest());
    const body = await res.json();

    // Totals include all 3 docs
    expect(body.issued).toBe(3);
    expect(body.redeemed).toBe(1);

    // Monthly only has the one with a valid createdAt
    const totalMonthlyIssued = body.monthly.reduce(
      (sum: number, m: { issued: number }) => sum + m.issued,
      0,
    );
    expect(totalMonthlyIssued).toBe(1);
  });

  it('includes status from partner doc in response', async () => {
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ status: 'pending' }),
    }));
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.status).toBe('pending');
  });

  it('returns conversionPct 0 when no referrals issued', async () => {
    mockReferralsQueryGet.mockImplementation(async () => ({ docs: [] }));
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.conversionPct).toBe(0);
  });

  it('returns monthly array with exactly 6 entries', async () => {
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.monthly).toHaveLength(6);
    // Each entry has month, issued, redeemed
    for (const entry of body.monthly) {
      expect(typeof entry.month).toBe('string');
      expect(entry.month).toMatch(/^\d{4}-\d{2}$/);
      expect(typeof entry.issued).toBe('number');
      expect(typeof entry.redeemed).toBe('number');
    }
  });
});

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the route ────────────────────────────

const mockGetScanById = mock(async (_id: string) => null as unknown);
const mockIssueReferral = mock(async (_args: unknown) => ({
  code: 'AbCdEf12',
  expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
}));

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request) => null as unknown);

// Firestore partner doc mock
const mockPartnerGet = mock(async () => ({
  exists: true,
  data: () => ({ kind: 'partner', status: 'verified', discountPct: 10 }),
}));
const mockPartnerDoc = mock(() => ({ get: mockPartnerGet }));
const mockCollection = mock(() => ({ doc: mockPartnerDoc }));
const mockDb = mock(() => ({ collection: mockCollection }));

mock.module('../../lib/scan-store', () => ({ getScanById: mockGetScanById }));
mock.module('../../lib/referrals', () => ({ issueReferral: mockIssueReferral }));
mock.module('../../lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
mock.module('../../lib/firebase/verify-token', () => ({
  verifyBearerToken: mockVerifyBearerToken,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));

const { POST } = await import('../../app/api/referrals/route');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VALID_PARTNER = 'partner-abc';

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/referrals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const MOCK_SCAN = {
  id: VALID_UUID,
  text: '',
  result: { cost: { co2_kg: 2.1, water_liters: 2700 } },
  createdAt: Date.now(),
};

describe('POST /api/referrals', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
    mockVerifyBearerToken.mockImplementation(async () => null);
    mockGetScanById.mockImplementation(async () => MOCK_SCAN);
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ kind: 'partner', status: 'verified', discountPct: 10 }),
    }));
    mockIssueReferral.mockImplementation(async () => ({
      code: 'AbCdEf12',
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    }));
  });

  // ─── Rate limiting ─────────────────────────────────────────────────────────

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: false, retryAfter: 30 }));
    const res = await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  // ─── Input validation ──────────────────────────────────────────────────────

  it('returns 400 when scanId is missing', async () => {
    const res = await POST(makeRequest({ partnerId: VALID_PARTNER }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/scanId/);
  });

  it('returns 400 when partnerId is missing', async () => {
    const res = await POST(makeRequest({ scanId: VALID_UUID }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/partnerId/);
  });

  it('returns 400 for invalid scanId UUID format', async () => {
    const res = await POST(makeRequest({ scanId: 'not-a-uuid', partnerId: VALID_PARTNER }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid scan ID/);
  });

  it('returns 400 for non-JSON body', async () => {
    const req = new Request('http://localhost/api/referrals', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/);
  });

  // ─── Business logic ────────────────────────────────────────────────────────

  it('returns 404 when scan is not found', async () => {
    mockGetScanById.mockImplementation(async () => null);
    const res = await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/Scan not found/);
  });

  it('returns 403 when partner doc does not exist', async () => {
    mockPartnerGet.mockImplementation(async () => ({ exists: false, data: () => null }));
    const res = await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Partner not available/);
  });

  it('returns 403 when partner status is not verified', async () => {
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ kind: 'partner', status: 'pending', discountPct: 10 }),
    }));
    const res = await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Partner not available/);
  });

  it('returns 403 when partner kind is not "partner"', async () => {
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ kind: 'brand_claim', status: 'verified', discountPct: 10 }),
    }));
    const res = await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Partner not available/);
  });

  // ─── Happy path ────────────────────────────────────────────────────────────

  it('returns 201 with code, url, discountPct, expiresAt on success', async () => {
    const res = await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBe('AbCdEf12');
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('/redeem/AbCdEf12');
    expect(typeof body.discountPct).toBe('number');
    expect(typeof body.expiresAt).toBe('number');
  });

  it('uses discountPct from partner doc', async () => {
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ kind: 'partner', status: 'verified', discountPct: 15 }),
    }));
    await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    // issueReferral should have been called with discountPct: 15
    expect(mockIssueReferral).toHaveBeenCalled();
    const callArgs = mockIssueReferral.mock.calls[mockIssueReferral.mock.calls.length - 1]![0] as {
      discountPct: number;
    };
    expect(callArgs.discountPct).toBe(15);
  });

  // ─── Anonymous (no auth header) ────────────────────────────────────────────

  it('returns 201 for anonymous request (no Authorization header)', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    const res = await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toBeDefined();
  });

  it('passes userId when authenticated', async () => {
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'user-999', email: 'x@y.com' }));
    await POST(
      makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }, {
        Authorization: 'Bearer fake-token',
      }),
    );
    const callArgs = mockIssueReferral.mock.calls[mockIssueReferral.mock.calls.length - 1]![0] as {
      userId?: string;
    };
    expect(callArgs.userId).toBe('user-999');
  });

  it('does not pass userId for anonymous request', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    await POST(makeRequest({ scanId: VALID_UUID, partnerId: VALID_PARTNER }));
    const callArgs = mockIssueReferral.mock.calls[mockIssueReferral.mock.calls.length - 1]![0] as {
      userId?: string;
    };
    expect(callArgs.userId).toBeUndefined();
  });
});

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing routes ────────────────────────────────

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request) => null as unknown);
const mockRedeemReferral = mock(async (_code: string, _uid: string) => ({ ok: true } as unknown));

// Firestore mock — two separate collections: referrals and partners.
// We use a map keyed by collection+docId so tests can control both independently.
const mockReferralGet = mock(async () => ({
  exists: true,
  data: () => ({
    partnerId: 'partner-uid-1',
    discountPct: 10,
    status: 'issued',
    expiresAt: { toMillis: () => Date.now() + 7 * 24 * 60 * 60 * 1000 },
  }),
}));
const mockReferralDoc = mock(() => ({ get: mockReferralGet }));

const mockPartnerGet = mock(async () => ({
  exists: true,
  data: () => ({ businessName: 'Test Repairs', status: 'verified' }),
}));
const mockPartnerDoc = mock(() => ({ get: mockPartnerGet }));

const mockCollection = mock((name: string) => {
  if (name === 'partners') return { doc: mockPartnerDoc };
  return { doc: mockReferralDoc }; // referrals and any other collection
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
mock.module('../../lib/referrals', () => ({
  CODE_RE: /^[A-Za-z0-9_-]{8}$/,
  redeemReferral: mockRedeemReferral,
  // issueReferral is not used by the routes under test; include a stub so
  // other test files that import from this module don't get a missing-export error.
  issueReferral: mock(async () => ({ code: 'AbCdEf12', expiresAt: Date.now() + 1000 })),
}));

const { GET } = await import('../../app/api/referrals/[code]/route');
const { POST } = await import('../../app/api/referrals/[code]/redeem/route');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CODE = 'AbCdEf12';
const BAD_CODE = 'too-long-invalid-code';

function makeParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

function makeGetRequest(code: string) {
  return new Request(`http://localhost/api/referrals/${code}`, { method: 'GET' });
}

function makePostRequest(code: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/referrals/${code}/redeem`, {
    method: 'POST',
    headers,
  });
}

// ─── GET /api/referrals/[code] ────────────────────────────────────────────────

describe('GET /api/referrals/[code]', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
    mockReferralGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        partnerId: 'partner-uid-1',
        discountPct: 10,
        status: 'issued',
        expiresAt: { toMillis: () => Date.now() + 7 * 24 * 60 * 60 * 1000 },
      }),
    }));
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ businessName: 'Test Repairs', status: 'verified' }),
    }));
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: false, retryAfter: 30 }));
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('returns 400 for a bad code format', async () => {
    const res = await GET(makeGetRequest(BAD_CODE), makeParams(BAD_CODE));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid/);
  });

  it('returns 404 when code does not exist', async () => {
    mockReferralGet.mockImplementation(async () => ({ exists: false, data: () => null }));
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 200 with correct shape for an issued code', async () => {
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessName).toBe('Test Repairs');
    expect(body.discountPct).toBe(10);
    expect(body.status).toBe('issued');
    expect(typeof body.expiresAt).toBe('number');
  });

  it('does not expose userId or scanId in the response', async () => {
    mockReferralGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        partnerId: 'partner-uid-1',
        scanId: 'scan-secret-id',
        userId: 'user-secret-id',
        discountPct: 10,
        status: 'issued',
        expiresAt: { toMillis: () => Date.now() + 7 * 24 * 60 * 60 * 1000 },
      }),
    }));
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBeUndefined();
    expect(body.scanId).toBeUndefined();
  });

  it('returns status "expired" for a code with a past expiresAt', async () => {
    mockReferralGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        partnerId: 'partner-uid-1',
        discountPct: 10,
        status: 'issued',
        expiresAt: { toMillis: () => Date.now() - 1000 },
      }),
    }));
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('expired');
  });

  it('returns status "expired" for a code with malformed/missing expiresAt', async () => {
    mockReferralGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        partnerId: 'partner-uid-1',
        discountPct: 10,
        status: 'issued',
        expiresAt: null, // malformed
      }),
    }));
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('expired');
    expect(body.expiresAt).toBeNull();
  });

  it('returns status "redeemed" for an already-redeemed code', async () => {
    mockReferralGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        partnerId: 'partner-uid-1',
        discountPct: 10,
        status: 'redeemed',
        expiresAt: { toMillis: () => Date.now() - 1000 }, // even if past
      }),
    }));
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('redeemed');
  });

  it('uses "Unknown business" when partner doc is missing', async () => {
    mockPartnerGet.mockImplementation(async () => ({ exists: false, data: () => null }));
    const res = await GET(makeGetRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessName).toBe('Unknown business');
  });
});

// ─── POST /api/referrals/[code]/redeem ────────────────────────────────────────

describe('POST /api/referrals/[code]/redeem', () => {
  beforeEach(() => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'partner-uid-1', email: 'p@biz.com' }));
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ status: 'verified' }),
    }));
    mockRedeemReferral.mockImplementation(async () => ({ ok: true }));
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: false, retryAfter: 20 }));
    const res = await POST(makePostRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(429);
  });

  it('returns 400 for a bad code format', async () => {
    const res = await POST(makePostRequest(BAD_CODE), makeParams(BAD_CODE));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid/);
  });

  it('returns 401 when no bearer token is provided', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    const res = await POST(makePostRequest(VALID_CODE), makeParams(VALID_CODE));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Authentication/);
  });

  it('returns 403 when partner doc does not exist', async () => {
    mockPartnerGet.mockImplementation(async () => ({ exists: false, data: () => null }));
    const res = await POST(
      makePostRequest(VALID_CODE, { Authorization: 'Bearer token' }),
      makeParams(VALID_CODE),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Not a verified partner/);
  });

  it('returns 403 when partner status is not verified', async () => {
    mockPartnerGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ status: 'pending' }),
    }));
    const res = await POST(
      makePostRequest(VALID_CODE, { Authorization: 'Bearer token' }),
      makeParams(VALID_CODE),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/Not a verified partner/);
  });

  it('returns 200 with { ok: true } on successful redemption', async () => {
    const res = await POST(
      makePostRequest(VALID_CODE, { Authorization: 'Bearer token' }),
      makeParams(VALID_CODE),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns 404 when redeemReferral returns not_found', async () => {
    mockRedeemReferral.mockImplementation(async () => ({ ok: false, reason: 'not_found' }));
    const res = await POST(
      makePostRequest(VALID_CODE, { Authorization: 'Bearer token' }),
      makeParams(VALID_CODE),
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 when redeemReferral returns wrong_partner', async () => {
    mockRedeemReferral.mockImplementation(async () => ({ ok: false, reason: 'wrong_partner' }));
    const res = await POST(
      makePostRequest(VALID_CODE, { Authorization: 'Bearer token' }),
      makeParams(VALID_CODE),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/different business/);
  });

  it('returns 409 when redeemReferral returns already_redeemed', async () => {
    mockRedeemReferral.mockImplementation(async () => ({ ok: false, reason: 'already_redeemed' }));
    const res = await POST(
      makePostRequest(VALID_CODE, { Authorization: 'Bearer token' }),
      makeParams(VALID_CODE),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already been redeemed/);
  });

  it('returns 410 when redeemReferral returns expired', async () => {
    mockRedeemReferral.mockImplementation(async () => ({ ok: false, reason: 'expired' }));
    const res = await POST(
      makePostRequest(VALID_CODE, { Authorization: 'Bearer token' }),
      makeParams(VALID_CODE),
    );
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/expired/i);
  });
});

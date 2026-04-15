import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the route ────────────────────────────

const mockRecordOutcome = mock(async (_id: string, _action: string) => ({
  conflict: false,
  stored: {
    id: 'scan-uuid',
    text: '',
    result: {
      cost: { co2_kg: 2.1, water_liters: 2700 },
    },
    createdAt: Date.now(),
    outcome: _action,
    outcomeAt: Date.now(),
  },
}));

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request) => null);
const mockBatchCommit = mock(async () => {});
const mockBatchSet = mock(() => {});
const mockBatch = mock(() => ({ set: mockBatchSet, commit: mockBatchCommit }));
const mockDoc = mock(() => ({ id: 'new-doc-id' }));
const mockCollection = mock(() => ({ doc: mockDoc }));
const mockDb = mock(() => ({ collection: mockCollection, batch: mockBatch }));

mock.module('../../lib/scan-store', () => ({ recordOutcome: mockRecordOutcome }));
mock.module('../../lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
mock.module('../../lib/firebase/verify-token', () => ({
  verifyBearerToken: mockVerifyBearerToken,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));
mock.module('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS', increment: (n: number) => ({ _increment: n }) },
}));

const { POST } = await import('../../app/api/scan/[id]/outcome/route');

// Helper to build a Next.js-style params Promise
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/scan/test-id/outcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

describe('POST /api/scan/[id]/outcome', () => {
  beforeEach(() => {
    mockRecordOutcome.mockImplementation(async (_id, action) => ({
      conflict: false,
      stored: {
        id: VALID_UUID,
        text: '',
        result: { cost: { co2_kg: 2.1, water_liters: 2700 } },
        createdAt: Date.now(),
        outcome: action,
        outcomeAt: Date.now(),
      },
    }));
    mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
    mockVerifyBearerToken.mockImplementation(async () => null);
    mockBatchCommit.mockImplementation(async () => {});
  });

  // ─── Input validation ───────────────────────────────────────────────────────

  it('returns 400 for invalid UUID in path', async () => {
    const res = await POST(makeRequest({ action: 'repair' }), makeParams('not-a-uuid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid scan ID/);
  });

  it('returns 400 for non-JSON body', async () => {
    const req = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'this is not json',
    });
    const res = await POST(req, makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/);
  });

  it('returns 400 when action field is missing', async () => {
    const res = await POST(makeRequest({}), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/action/);
  });

  it('returns 400 for invalid action value', async () => {
    const res = await POST(makeRequest({ action: 'sell_on_ebay' }), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/throw_away, repair, list, donate/);
  });

  it('accepts all valid action values', async () => {
    for (const action of ['throw_away', 'repair', 'list', 'donate']) {
      const res = await POST(makeRequest({ action }), makeParams(VALID_UUID));
      expect(res.status).toBe(200);
    }
  });

  // ─── Rate limiting ──────────────────────────────────────────────────────────

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: false, retryAfter: 45 }));
    const res = await POST(makeRequest({ action: 'repair' }), makeParams(VALID_UUID));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('45');
  });

  // ─── Business logic ─────────────────────────────────────────────────────────

  it('returns 404 when scan is not found', async () => {
    mockRecordOutcome.mockImplementation(async () => ({ conflict: false, stored: null }));
    const res = await POST(makeRequest({ action: 'repair' }), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it('returns 409 when outcome already recorded', async () => {
    mockRecordOutcome.mockImplementation(async () => ({
      conflict: true,
      stored: { id: VALID_UUID, outcome: 'repair', result: { cost: {} }, createdAt: 0 },
    }));
    const res = await POST(makeRequest({ action: 'donate' }), makeParams(VALID_UUID));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already recorded/);
  });

  it('returns 200 with id and outcome on success', async () => {
    const res = await POST(makeRequest({ action: 'repair' }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.outcome).toBe('repair');
  });

  it('does not expose full scan result in response', async () => {
    const res = await POST(makeRequest({ action: 'repair' }), makeParams(VALID_UUID));
    const body = await res.json();
    expect(body.result).toBeUndefined();
    expect(body.cost).toBeUndefined();
    expect(body.garment).toBeUndefined();
  });

  // ─── Authenticated user path ────────────────────────────────────────────────

  it('calls Firestore batch for authenticated non-throw_away outcome', async () => {
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'user-123', email: 'a@b.com' }));
    mockBatchCommit.mockClear();

    const res = await POST(makeRequest({ action: 'repair' }), makeParams(VALID_UUID));
    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('does NOT call Firestore batch for throw_away outcome', async () => {
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'user-123', email: 'a@b.com' }));
    mockBatchCommit.mockClear();

    await POST(makeRequest({ action: 'throw_away' }), makeParams(VALID_UUID));
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('still returns 200 if Firestore batch fails (degrades gracefully)', async () => {
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'user-123', email: 'a@b.com' }));
    mockBatchCommit.mockImplementation(async () => { throw new Error('Firestore unavailable'); });

    const res = await POST(makeRequest({ action: 'repair' }), makeParams(VALID_UUID));
    // Outcome is recorded even though Firestore credit failed
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe('repair');
  });

  it('skips Firestore batch for unauthenticated request', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    mockBatchCommit.mockClear();

    await POST(makeRequest({ action: 'repair' }), makeParams(VALID_UUID));
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the route ────────────────────────────

// Simulated Firestore user doc — null means the doc does not exist yet.
let docData: Record<string, any> | null = null;

const mockVerifyBearerToken = mock(
  async (_req: Request): Promise<{ uid: string; email: string | undefined } | null> => ({
    uid: 'user-123',
    email: 'a@b.com',
  }),
);
const mockSet = mock(async (_data: Record<string, unknown>, _opts?: { merge?: boolean }) => {});
const mockGet = mock(async () => ({
  exists: docData !== null,
  data: () => docData ?? undefined,
}));
const mockDoc = mock(() => ({ get: mockGet, set: mockSet }));
const mockCollection = mock(() => ({ doc: mockDoc }));
const mockDb = mock(() => ({ collection: mockCollection }));
const mockGeocodeAddress = mock(
  async (_address: string): Promise<{ lat: number; lng: number } | null> => ({
    lat: 43.65,
    lng: -79.38,
  }),
);

mock.module('../../lib/firebase/verify-token', () => ({
  verifyBearerToken: mockVerifyBearerToken,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));
mock.module('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
}));
mock.module('../../lib/google/places', () => ({ geocodeAddress: mockGeocodeAddress }));

const { POST } = await import('../../app/api/auth/callback/route');

function makeRequest(body?: unknown) {
  return new Request('http://localhost/api/auth/callback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const RETAILER_PAYLOAD = {
  storeName: 'Uptown Cheapskate',
  street1: '123 Main St',
  city: 'Madison',
  state: 'WI',
  zip: '53703',
  phone: '608-555-0123',
};

describe('POST /api/auth/callback', () => {
  beforeEach(() => {
    docData = null;
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'user-123', email: 'a@b.com' }));
    mockGeocodeAddress.mockImplementation(async () => ({ lat: 43.65, lng: -79.38 }));
    mockSet.mockClear();
    mockGet.mockClear();
    mockGeocodeAddress.mockClear();
  });

  it('returns role user and null retailerStatus for a body-less request from an existing plain user', async () => {
    docData = {
      email: 'a@b.com',
      displayName: 'Jae',
      avatarUrl: null,
      totalCO2SavedKg: 4.2,
      totalWaterSavedLiters: 5400,
      actionCount: 2,
    };

    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('user');
    expect(body.retailerStatus).toBeNull();
    expect(body.storeName).toBeNull();
    // Existing behavior preserved
    expect(body.displayName).toBe('Jae');
    expect(body.actionCount).toBe(2);
  });

  it('creates a pending retailer doc for a new user with a retailer payload', async () => {
    const res = await POST(makeRequest({ retailer: RETAILER_PAYLOAD }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.role).toBe('retailer');
    expect(body.retailerStatus).toBe('pending');
    expect(body.storeName).toBe('Uptown Cheapskate');

    expect(mockGeocodeAddress).toHaveBeenCalledWith('123 Main St, Madison, WI 53703');

    expect(mockSet).toHaveBeenCalledTimes(1);
    const written = mockSet.mock.calls[0]![0] as Record<string, any>;
    expect(written.role).toBe('retailer');
    expect(written.retailer.status).toBe('pending');
    expect(written.retailer.storeName).toBe('Uptown Cheapskate');
    expect(written.retailer.lat).toBe(43.65);
    expect(written.retailer.lng).toBe(-79.38);
    expect(written.retailer.appliedAt).toBe('SERVER_TS');
  });

  it('returns 400 for an invalid zip', async () => {
    const res = await POST(makeRequest({ retailer: { ...RETAILER_PAYLOAD, zip: 'abcde' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeString();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('returns 400 when a retailer field is missing', async () => {
    const { phone: _phone, ...missingPhone } = RETAILER_PAYLOAD;
    const res = await POST(makeRequest({ retailer: missingPhone }));
    expect(res.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('never downgrades an already-approved retailer', async () => {
    docData = {
      email: 'a@b.com',
      displayName: null,
      avatarUrl: null,
      totalCO2SavedKg: 0,
      totalWaterSavedLiters: 0,
      actionCount: 0,
      role: 'retailer',
      retailer: { ...RETAILER_PAYLOAD, storeName: 'Existing Store', lat: 1, lng: 2, status: 'approved' },
    };

    const res = await POST(makeRequest({ retailer: RETAILER_PAYLOAD }));
    expect(res.status).toBe(200);

    // No write may contain a retailer block or role — approved status is untouchable.
    for (const call of mockSet.mock.calls) {
      const written = call[0] as Record<string, unknown>;
      expect(written).not.toContainKey('retailer');
      expect(written).not.toContainKey('role');
    }

    const body = await res.json();
    expect(body.role).toBe('retailer');
    expect(body.retailerStatus).toBe('approved');
    expect(body.storeName).toBe('Existing Store');
  });

  it('still succeeds with null coordinates when geocoding fails', async () => {
    mockGeocodeAddress.mockImplementation(async () => null);

    const res = await POST(makeRequest({ retailer: RETAILER_PAYLOAD }));
    expect(res.status).toBe(200);

    const written = mockSet.mock.calls[0]![0] as Record<string, any>;
    expect(written.retailer.lat).toBeNull();
    expect(written.retailer.lng).toBeNull();
    expect(written.retailer.status).toBe('pending');

    const body = await res.json();
    expect(body.retailerStatus).toBe('pending');
  });
});

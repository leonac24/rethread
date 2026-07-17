import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the module ───────────────────────────

const mockVerifyBearerToken = mock(async (_req: Request) => null as { uid: string; email?: string } | null);
const mockGet = mock(async () => ({ exists: false, data: () => undefined }) as {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
});
const mockDoc = mock((_uid: string) => ({ get: mockGet }));
const mockCollection = mock((_name: string) => ({ doc: mockDoc }));
const mockDb = mock(() => ({ collection: mockCollection }));

mock.module('../../lib/firebase/verify-token', () => ({
  verifyBearerToken: mockVerifyBearerToken,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb, adminStorage: () => ({ bucket: () => ({}) }) }));

const { verifyApprovedRetailer } = await import('../../lib/firebase/verify-retailer');

function makeRequest() {
  return new Request('http://localhost/api/marketplace/listings', {
    headers: { Authorization: 'Bearer some-token' },
  });
}

const APPROVED_USER_DOC = {
  role: 'retailer',
  retailer: {
    storeName: 'Second Stitch',
    phone: '555-0100',
    street1: '12 Thread Ln',
    city: 'Portland',
    state: 'OR',
    zip: '97201',
    lat: 45.52,
    lng: -122.68,
    status: 'approved',
  },
};

describe('verifyApprovedRetailer', () => {
  beforeEach(() => {
    mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'retailer-1', email: 'r@x.com' }));
    mockGet.mockImplementation(async () => ({ exists: true, data: () => APPROVED_USER_DOC }));
  });

  it('returns null when there is no valid bearer token', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    expect(await verifyApprovedRetailer(makeRequest())).toBeNull();
  });

  it('returns null when the user doc does not exist', async () => {
    mockGet.mockImplementation(async () => ({ exists: false, data: () => undefined }));
    expect(await verifyApprovedRetailer(makeRequest())).toBeNull();
  });

  it('returns null when role is user', async () => {
    mockGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({ ...APPROVED_USER_DOC, role: 'user' }),
    }));
    expect(await verifyApprovedRetailer(makeRequest())).toBeNull();
  });

  it('returns null when retailer status is pending', async () => {
    mockGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        ...APPROVED_USER_DOC,
        retailer: { ...APPROVED_USER_DOC.retailer, status: 'pending' },
      }),
    }));
    expect(await verifyApprovedRetailer(makeRequest())).toBeNull();
  });

  it('returns null when the Firestore read throws', async () => {
    mockGet.mockImplementation(async () => { throw new Error('Firestore unavailable'); });
    expect(await verifyApprovedRetailer(makeRequest())).toBeNull();
  });

  it('returns the flattened profile for an approved retailer', async () => {
    const retailer = await verifyApprovedRetailer(makeRequest());
    expect(retailer).toEqual({
      uid: 'retailer-1',
      storeName: 'Second Stitch',
      phone: '555-0100',
      street1: '12 Thread Ln',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
      lat: 45.52,
      lng: -122.68,
    });
  });

  it('defaults lat/lng to null when the profile has none', async () => {
    mockGet.mockImplementation(async () => ({
      exists: true,
      data: () => ({
        ...APPROVED_USER_DOC,
        retailer: { ...APPROVED_USER_DOC.retailer, lat: undefined, lng: undefined },
      }),
    }));
    const retailer = await verifyApprovedRetailer(makeRequest());
    expect(retailer?.lat).toBeNull();
    expect(retailer?.lng).toBeNull();
  });
});

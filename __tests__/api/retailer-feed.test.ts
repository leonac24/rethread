import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { verifyApprovedRetailer } from '../../lib/firebase/verify-retailer';
import type { VerifiedRetailer } from '../../lib/firebase/verify-retailer';

// Snapshot the real implementation so afterAll can undo the module mock —
// bun module mocks are process-global and would break the unit test otherwise.
const actualVerifyApprovedRetailer = verifyApprovedRetailer;

// ─── Mock dependencies before importing the route ────────────────────────────

const mockVerifyApprovedRetailer = mock(
  async (_req: Request): Promise<VerifiedRetailer | null> => null,
);

type DocData = Record<string, unknown>;

let feedDocs: Array<{ id: string; data: DocData }> = [];

const mockDb = mock(() => ({
  collection: (_name: string) => ({
    where: (_field: string, _op: string, _value: unknown) => ({
      get: async () => ({
        docs: feedDocs.map((d) => ({ id: d.id, data: () => d.data })),
      }),
    }),
  }),
}));

mock.module('../../lib/firebase/verify-retailer', () => ({
  verifyApprovedRetailer: mockVerifyApprovedRetailer,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb, adminStorage: () => ({ bucket: () => ({}) }), storageBucketName: () => 'test-bucket' }));

const { GET } = await import('../../app/api/retailer/listings/route');

const RETAILER: VerifiedRetailer = {
  uid: 'ret-1',
  storeName: 'Uptown Cheapskate',
  phone: '555-0100',
  street1: '1 Queen St',
  city: 'Toronto',
  state: 'ON',
  zip: '10001',
  lat: 43.65,
  lng: -79.38,
};

function getReq() {
  return new Request('http://localhost/api/retailer/listings');
}

function listingDoc(overrides: DocData = {}): DocData {
  return {
    ownerUid: 'owner-1',
    scanId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    status: 'active',
    garment: {
      brand: 'Madewell',
      category: 'jeans',
      condition: 'good',
      fibers: [{ material: 'cotton', percentage: 99 }],
    },
    imageUrls: ['https://img/1.jpg'],
    estimate: { low_usd: 6, high_usd: 10, confidence: 'medium', factors: [] },
    approxLocation: { lat: 43.66, lng: -79.38 },
    offerCount: 0,
    shipFrom: { name: 'Owner', street1: '2 Home Ave', city: 'Toronto', state: 'ON', zip: '10001' },
    dropoffCode: 'ABCDEF',
    createdAt: { toMillis: () => 1_700_000_000_000 },
    ...overrides,
  };
}

beforeEach(() => {
  mockVerifyApprovedRetailer.mockImplementation(async () => ({ ...RETAILER }));
  feedDocs = [];
});

afterAll(() => {
  mock.module('../../lib/firebase/verify-retailer', () => ({
    verifyApprovedRetailer: actualVerifyApprovedRetailer,
  }));
});

describe('GET /api/retailer/listings', () => {
  it('403 when caller is not an approved retailer', async () => {
    mockVerifyApprovedRetailer.mockImplementation(async () => null);
    const res = await GET(getReq());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Approved retailer account required.');
  });

  it('strips estimate, ownerUid, scanId, shipFrom, and dropoffCode', async () => {
    feedDocs = [{ id: 'listing123abc', data: listingDoc() }];
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings).toHaveLength(1);
    const item = body.listings[0];
    expect(item.id).toBe('listing123abc');
    expect(item.garment.brand).toBe('Madewell');
    expect(item.condition).toBe('good');
    expect(item.imageUrls).toEqual(['https://img/1.jpg']);
    expect(item.createdAt).toBe(1_700_000_000_000);
    expect('estimate' in item).toBe(false);
    expect('ownerUid' in item).toBe(false);
    expect('scanId' in item).toBe(false);
    expect('shipFrom' in item).toBe(false);
    expect('dropoffCode' in item).toBe(false);
  });

  it('sorts by distance ascending with unlocated listings last', async () => {
    feedDocs = [
      {
        id: 'farListing123',
        data: listingDoc({
          approxLocation: { lat: 44.65, lng: -79.38 },
          createdAt: { toMillis: () => 3_000 },
        }),
      },
      {
        id: 'noLocation1234',
        data: listingDoc({
          approxLocation: null,
          createdAt: { toMillis: () => 2_000 },
        }),
      },
      {
        id: 'nearListing12',
        data: listingDoc({
          approxLocation: { lat: 43.66, lng: -79.38 },
          createdAt: { toMillis: () => 1_000 },
        }),
      },
    ];
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listings.map((l: { id: string }) => l.id)).toEqual([
      'nearListing12',
      'farListing123',
      'noLocation1234',
    ]);
    expect(body.listings[0].distanceKm).toBeCloseTo(1.1, 5);
    expect(body.listings[1].distanceKm).toBeCloseTo(111.2, 5);
    expect(body.listings[2].distanceKm).toBeNull();
  });

  it('returns null distance for every listing when the store has no coordinates', async () => {
    mockVerifyApprovedRetailer.mockImplementation(async () => ({
      ...RETAILER,
      lat: null,
      lng: null,
    }));
    feedDocs = [{ id: 'listing123abc', data: listingDoc() }];
    const res = await GET(getReq());
    const body = await res.json();
    expect(body.listings[0].distanceKm).toBeNull();
  });
});

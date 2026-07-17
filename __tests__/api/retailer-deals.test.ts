import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { verifyApprovedRetailer } from '../../lib/firebase/verify-retailer';

// Snapshot the real implementation so afterAll can undo the module mock —
// bun module mocks are process-global and would break the unit test otherwise.
const actualVerifyApprovedRetailer = verifyApprovedRetailer;

type Retailer = { uid: string; storeName: string } | null;
const mockVerifyApprovedRetailer = mock(async (_req: Request): Promise<Retailer> => ({
  uid: 'ret-1',
  storeName: 'Uptown Cheapskate',
}));

let listingDocs: Array<{ id: string; data: Record<string, unknown> }> = [];

const mockDb = mock(() => ({
  collection: (_name: string) => ({
    where: (_f: string, _op: string, _v: unknown) => ({
      get: async () => ({
        docs: listingDocs.map((d) => ({ id: d.id, data: () => d.data })),
      }),
    }),
  }),
}));

mock.module('../../lib/firebase/verify-retailer', () => ({
  verifyApprovedRetailer: mockVerifyApprovedRetailer,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb, adminStorage: () => ({ bucket: () => ({}) }), storageBucketName: () => 'test-bucket' }));

const { GET } = await import('../../app/api/retailer/deals/route');

afterAll(() => {
  mock.module('../../lib/firebase/verify-retailer', () => ({
    verifyApprovedRetailer: actualVerifyApprovedRetailer,
  }));
});

function req() {
  return new Request('http://localhost/api/retailer/deals');
}

beforeEach(() => {
  mockVerifyApprovedRetailer.mockImplementation(async () => ({
    uid: 'ret-1',
    storeName: 'Uptown Cheapskate',
  }));
  listingDocs = [];
});

describe('GET /api/retailer/deals', () => {
  it('403 when not an approved retailer', async () => {
    mockVerifyApprovedRetailer.mockImplementation(async () => null);
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it('filters to accepted/completed, strips estimate and ownerUid, sorts newest first', async () => {
    listingDocs = [
      {
        id: 'dealOld12345',
        data: {
          status: 'accepted',
          estimate: { low_usd: 4, high_usd: 8 },
          ownerUid: 'secret-user',
          acceptedAmountUsd: 9,
          acceptedAt: { toMillis: () => 1_000 },
        },
      },
      {
        id: 'cancelledOne12',
        data: { status: 'cancelled', acceptedAt: { toMillis: () => 5_000 } },
      },
      {
        id: 'dealNew12345',
        data: {
          status: 'completed',
          finalAmountUsd: 12,
          acceptedAt: { toMillis: () => 2_000 },
        },
      },
    ];
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deals).toHaveLength(2);
    expect(body.deals[0].id).toBe('dealNew12345');
    expect(body.deals[1].id).toBe('dealOld12345');
    expect(body.deals[1].estimate).toBeUndefined();
    expect(body.deals[1].ownerUid).toBeUndefined();
    expect(body.deals[1].acceptedAmountUsd).toBe(9);
  });
});

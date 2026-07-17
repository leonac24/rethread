import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the routes ───────────────────────────

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request): Promise<{ uid: string; email?: string } | null> => null);

type DocData = Record<string, unknown>;

// Simple in-memory Firestore double: get/set per-path snapshots, batch recorder.
let scanDocData: DocData | null = null;
let listingDocData: DocData | null = null;
let offerDocs: Array<{ id: string; data: DocData }> = [];

const batchOps: Array<{ op: string; path: string; data?: DocData }> = [];
const mockBatchCommit = mock(async () => {});

function makeDocRef(path: string, getData: () => DocData | null): DocData {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: getData() !== null,
      id: path.split('/').pop(),
      data: () => getData(),
      ref: makeDocRef(path, getData),
    }),
  };
}

const mockDb = mock(() => ({
  collection: (name: string) => ({
    doc: (id?: string) => {
      const docId = id ?? 'newListingId123';
      if (name === 'listings') {
        const ref = makeDocRef(`listings/${docId}`, () => listingDocData);
        (ref as Record<string, unknown>).collection = (sub: string) => ({
          orderBy: () => ({
            get: async () => ({
              docs: offerDocs.map((d) => ({
                id: d.id,
                data: () => d.data,
              })),
            }),
          }),
          where: () => ({
            where: () => ({
              get: async () => ({ empty: true, docs: [] }),
            }),
          }),
          doc: (offerId: string) => makeDocRef(`listings/${docId}/${sub}/${offerId}`, () => null),
        });
        return ref;
      }
      // users collection
      const userRef = makeDocRef(`${name}/${docId}`, () => null);
      (userRef as Record<string, unknown>).collection = (sub: string) => ({
        doc: (scanId: string) => makeDocRef(`${name}/${docId}/${sub}/${scanId}`, () => scanDocData),
      });
      return userRef;
    },
  }),
  batch: () => ({
    set: (ref: { path: string }, data: DocData) => batchOps.push({ op: 'set', path: ref.path, data }),
    update: (ref: { path: string }, data: DocData) => batchOps.push({ op: 'update', path: ref.path, data }),
    delete: (ref: { path: string }) => batchOps.push({ op: 'delete', path: ref.path }),
    commit: mockBatchCommit,
  }),
}));

mock.module('../../lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
mock.module('../../lib/firebase/verify-token', () => ({
  verifyBearerToken: mockVerifyBearerToken,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));
mock.module('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    increment: (n: number) => ({ _increment: n }),
  },
}));

const { POST } = await import('../../app/api/listings/route');
const { GET, PATCH } = await import('../../app/api/listings/[id]/route');

const VALID_SCAN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const LISTING_ID = 'newListingId123';

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function postReq(body: unknown) {
  return new Request('http://localhost/api/listings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown) {
  return new Request(`http://localhost/api/listings/${LISTING_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SCAN_DOC: DocData = {
  scanId: VALID_SCAN_ID,
  action: 'list',
  imageUrls: ['https://img/1.jpg'],
  result: {
    garment: {
      brand: 'Madewell',
      category: 'jeans',
      color: 'indigo',
      condition: 'good',
      fibers: [{ material: 'cotton', percentage: 99 }],
    },
    cost: { resale: { low_usd: 6, high_usd: 10, confidence: 'medium', factors: ['denim resells strongly'] } },
  },
};

beforeEach(() => {
  mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'owner-1' }));
  mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
  mockBatchCommit.mockClear();
  batchOps.length = 0;
  scanDocData = { ...SCAN_DOC };
  listingDocData = null;
  offerDocs = [];
});

describe('POST /api/listings', () => {
  it('401 when unauthenticated', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    const res = await POST(postReq({ scanId: VALID_SCAN_ID }));
    expect(res.status).toBe(401);
  });

  it('400 for invalid scanId', async () => {
    const res = await POST(postReq({ scanId: 'nope' }));
    expect(res.status).toBe(400);
  });

  it('404 when scan does not exist', async () => {
    scanDocData = null;
    const res = await POST(postReq({ scanId: VALID_SCAN_ID }));
    expect(res.status).toBe(404);
  });

  it('409 when scan already has an active listing', async () => {
    scanDocData = { ...SCAN_DOC, listingId: 'existing123abc', listingStatus: 'active' };
    const res = await POST(postReq({ scanId: VALID_SCAN_ID }));
    expect(res.status).toBe(409);
  });

  it('201 creates listing and mirrors onto the scan doc', async () => {
    const res = await POST(postReq({ scanId: VALID_SCAN_ID, lat: 43.65789, lng: -79.38123 }));
    expect(res.status).toBe(201);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    const listingSet = batchOps.find((o) => o.path.startsWith('listings/'));
    expect(listingSet).toBeDefined();
    expect(listingSet!.data!.status).toBe('active');
    expect(listingSet!.data!.ownerUid).toBe('owner-1');
    expect((listingSet!.data!.approxLocation as { lat: number }).lat).toBe(43.66);
    expect((listingSet!.data!.estimate as { low_usd: number }).low_usd).toBe(6);

    const mirrorSet = batchOps.find((o) => o.path.includes('/scans/'));
    expect(mirrorSet).toBeDefined();
    expect(mirrorSet!.data!.listingStatus).toBe('active');

    const body = await res.json();
    expect(body.listing.id).toBeDefined();
  });

  it('allows relisting after a cancelled listing', async () => {
    scanDocData = { ...SCAN_DOC, listingId: 'old1234567890', listingStatus: 'cancelled' };
    const res = await POST(postReq({ scanId: VALID_SCAN_ID }));
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/listings/[id]', () => {
  it('404 when listing is owned by someone else', async () => {
    listingDocData = { ownerUid: 'other-user', scanId: VALID_SCAN_ID, status: 'active' };
    const res = await PATCH(patchReq({ status: 'cancelled' }), makeParams(LISTING_ID));
    expect(res.status).toBe(404);
  });

  it('409 when listing is not active', async () => {
    listingDocData = { ownerUid: 'owner-1', scanId: VALID_SCAN_ID, status: 'accepted' };
    const res = await PATCH(patchReq({ status: 'cancelled' }), makeParams(LISTING_ID));
    expect(res.status).toBe(409);
  });

  it('200 cancels an active listing and updates the mirror', async () => {
    listingDocData = { ownerUid: 'owner-1', scanId: VALID_SCAN_ID, status: 'active' };
    const res = await PATCH(patchReq({ status: 'cancelled' }), makeParams(LISTING_ID));
    expect(res.status).toBe(200);
    const listingUpdate = batchOps.find((o) => o.path === `listings/${LISTING_ID}`);
    expect(listingUpdate!.data!.status).toBe('cancelled');
    const mirror = batchOps.find((o) => o.path.includes('/scans/'));
    expect(mirror!.data!.listingStatus).toBe('cancelled');
  });
});

describe('GET /api/listings/[id]', () => {
  it('404 for non-owner', async () => {
    listingDocData = { ownerUid: 'other-user', scanId: VALID_SCAN_ID, status: 'active' };
    const res = await GET(patchReq({}), makeParams(LISTING_ID));
    expect(res.status).toBe(404);
  });

  it('returns listing with offers array', async () => {
    listingDocData = { ownerUid: 'owner-1', scanId: VALID_SCAN_ID, status: 'active', offerCount: 1 };
    offerDocs = [
      {
        id: 'offer1',
        data: {
          retailerUid: 'ret-1',
          storeName: 'Uptown Cheapskate',
          amountUsd: 12,
          status: 'open',
          createdAt: { toMillis: () => 1_700_000_000_000 },
        },
      },
    ];
    const res = await GET(patchReq({}), makeParams(LISTING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.listing.status).toBe('active');
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].storeName).toBe('Uptown Cheapskate');
    expect(body.offers[0].createdAt).toBe(1_700_000_000_000);
  });
});

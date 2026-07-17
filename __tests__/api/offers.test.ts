import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { verifyApprovedRetailer } from '../../lib/firebase/verify-retailer';
import type { VerifiedRetailer } from '../../lib/firebase/verify-retailer';

// Snapshot the real implementation so afterAll can undo the module mock —
// bun module mocks are process-global and would break the unit test otherwise.
const actualVerifyApprovedRetailer = verifyApprovedRetailer;

// ─── Mock dependencies before importing the routes ───────────────────────────

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }) as { allowed: boolean; retryAfter?: number });
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyApprovedRetailer = mock(
  async (_req: Request): Promise<VerifiedRetailer | null> => null,
);

type DocData = Record<string, unknown>;

// Simple in-memory Firestore double: get/set per-path snapshots, batch recorder.
let listingDocData: DocData | null = null;
let offerDocData: DocData | null = null;
let openOfferDocs: Array<{ id: string; data: DocData }> = [];

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
    }),
  };
}

const mockDb = mock(() => ({
  collection: (name: string) => ({
    doc: (id?: string) => {
      const docId = id ?? 'autoDocId12345';
      if (name === 'listings') {
        const ref = makeDocRef(`listings/${docId}`, () => listingDocData);
        (ref as Record<string, unknown>).collection = (sub: string) => ({
          where: () => ({
            where: () => ({
              get: async () => ({
                empty: openOfferDocs.length === 0,
                docs: openOfferDocs.map((d) => ({ id: d.id, data: () => d.data })),
              }),
            }),
          }),
          doc: (offerId?: string) =>
            makeDocRef(`listings/${docId}/${sub}/${offerId ?? 'newOfferId1234'}`, () => offerDocData),
        });
        return ref;
      }
      // users collection
      const userRef = makeDocRef(`${name}/${docId}`, () => null);
      (userRef as Record<string, unknown>).collection = (sub: string) => ({
        doc: (scanId: string) => makeDocRef(`${name}/${docId}/${sub}/${scanId}`, () => null),
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
mock.module('../../lib/firebase/verify-retailer', () => ({
  verifyApprovedRetailer: mockVerifyApprovedRetailer,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));
mock.module('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    increment: (n: number) => ({ _increment: n }),
  },
}));

const { POST } = await import('../../app/api/listings/[id]/offers/route');
const { PATCH } = await import('../../app/api/listings/[id]/offers/[offerId]/route');

const LISTING_ID = 'listing123abc';
const OFFER_ID = 'offerAbc12345';
const SCAN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

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

function postReq(body: unknown) {
  return new Request(`http://localhost/api/listings/${LISTING_ID}/offers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown) {
  return new Request(`http://localhost/api/listings/${LISTING_ID}/offers/${OFFER_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function postParams(id: string = LISTING_ID) {
  return { params: Promise.resolve({ id }) };
}

function patchParams(id: string = LISTING_ID, offerId: string = OFFER_ID) {
  return { params: Promise.resolve({ id, offerId }) };
}

beforeEach(() => {
  mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
  mockVerifyApprovedRetailer.mockImplementation(async () => ({ ...RETAILER }));
  mockBatchCommit.mockClear();
  batchOps.length = 0;
  listingDocData = { ownerUid: 'owner-1', scanId: SCAN_ID, status: 'active', offerCount: 0 };
  offerDocData = null;
  openOfferDocs = [];
});

afterAll(() => {
  mock.module('../../lib/firebase/verify-retailer', () => ({
    verifyApprovedRetailer: actualVerifyApprovedRetailer,
  }));
});

describe('POST /api/listings/[id]/offers', () => {
  it('429 when rate limited', async () => {
    mockCheckRateLimit.mockImplementation(() => ({ allowed: false, retryAfter: 30 }));
    const res = await POST(postReq({ amountUsd: 10 }), postParams());
    expect(res.status).toBe(429);
  });

  it('403 when caller is not an approved retailer', async () => {
    mockVerifyApprovedRetailer.mockImplementation(async () => null);
    const res = await POST(postReq({ amountUsd: 10 }), postParams());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Approved retailer account required.');
  });

  it('400 for invalid listing id', async () => {
    const res = await POST(postReq({ amountUsd: 10 }), postParams('a/b'));
    expect(res.status).toBe(400);
  });

  it.each([0, 10001, 12.5])('400 when amountUsd is %p', async (amountUsd) => {
    const res = await POST(postReq({ amountUsd }), postParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('amountUsd must be a whole dollar amount between 1 and 10000.');
  });

  it('400 when note exceeds 200 characters', async () => {
    const res = await POST(postReq({ amountUsd: 10, note: 'x'.repeat(201) }), postParams());
    expect(res.status).toBe(400);
  });

  it('404 when listing does not exist', async () => {
    listingDocData = null;
    const res = await POST(postReq({ amountUsd: 10 }), postParams());
    expect(res.status).toBe(404);
  });

  it('409 when listing is not active', async () => {
    listingDocData = { ownerUid: 'owner-1', scanId: SCAN_ID, status: 'accepted', offerCount: 1 };
    const res = await POST(postReq({ amountUsd: 10 }), postParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('This listing is no longer accepting offers.');
  });

  it('409 when the retailer already has an open offer', async () => {
    openOfferDocs = [{ id: 'existingOffer1', data: { retailerUid: 'ret-1', status: 'open' } }];
    const res = await POST(postReq({ amountUsd: 10 }), postParams());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('You already have an open offer on this listing.');
  });

  it('201 creates the offer and increments both counters in one batch', async () => {
    const res = await POST(postReq({ amountUsd: 12, note: '  Nice denim  ' }), postParams());
    expect(res.status).toBe(201);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    const offerSet = batchOps.find((o) => o.op === 'set' && o.path.includes('/offers/'));
    expect(offerSet).toBeDefined();
    expect(offerSet!.data!.retailerUid).toBe('ret-1');
    expect(offerSet!.data!.storeName).toBe('Uptown Cheapskate');
    expect(offerSet!.data!.storeLat).toBe(43.65);
    expect(offerSet!.data!.storeLng).toBe(-79.38);
    expect(offerSet!.data!.amountUsd).toBe(12);
    expect(offerSet!.data!.note).toBe('Nice denim');
    expect(offerSet!.data!.status).toBe('open');

    const listingUpdate = batchOps.find((o) => o.path === `listings/${LISTING_ID}`);
    expect(listingUpdate).toBeDefined();
    expect(listingUpdate!.data!.offerCount).toEqual({ _increment: 1 });

    const mirrorSet = batchOps.find((o) => o.path === `users/owner-1/scans/${SCAN_ID}`);
    expect(mirrorSet).toBeDefined();
    expect(mirrorSet!.data!.listingOfferCount).toEqual({ _increment: 1 });

    const body = await res.json();
    expect(body.offer.id).toBeDefined();
    expect(body.offer.amountUsd).toBe(12);
    expect(body.offer.status).toBe('open');
  });
});

describe('PATCH /api/listings/[id]/offers/[offerId]', () => {
  it("404 when the offer belongs to another retailer", async () => {
    offerDocData = { retailerUid: 'ret-2', status: 'open', amountUsd: 10 };
    const res = await PATCH(patchReq({ action: 'withdraw' }), patchParams());
    expect(res.status).toBe(404);
  });

  it('409 when the offer is not open', async () => {
    offerDocData = { retailerUid: 'ret-1', status: 'declined', amountUsd: 10 };
    const res = await PATCH(patchReq({ action: 'withdraw' }), patchParams());
    expect(res.status).toBe(409);
  });

  it('200 withdraws an open offer and decrements both counters', async () => {
    offerDocData = { retailerUid: 'ret-1', status: 'open', amountUsd: 10 };
    const res = await PATCH(patchReq({ action: 'withdraw' }), patchParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: OFFER_ID, status: 'withdrawn' });

    const offerUpdate = batchOps.find((o) => o.path === `listings/${LISTING_ID}/offers/${OFFER_ID}`);
    expect(offerUpdate).toBeDefined();
    expect(offerUpdate!.data!.status).toBe('withdrawn');

    const listingUpdate = batchOps.find((o) => o.path === `listings/${LISTING_ID}`);
    expect(listingUpdate!.data!.offerCount).toEqual({ _increment: -1 });

    const mirrorSet = batchOps.find((o) => o.path === `users/owner-1/scans/${SCAN_ID}`);
    expect(mirrorSet).toBeDefined();
    expect(mirrorSet!.data!.listingOfferCount).toEqual({ _increment: -1 });
  });
});

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the routes ───────────────────────────

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request): Promise<{ uid: string; email?: string } | null> => null);

type DocData = Record<string, unknown>;

let listingDocData: DocData | null = null;
let offerDocsById: Record<string, DocData> = {};

const batchOps: Array<{ op: string; path: string; data?: DocData }> = [];
const mockBatchCommit = mock(async () => {});

function makeDocRef(path: string, getData: () => DocData | null): DocData {
  const ref: DocData = {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: getData() !== null,
      id: path.split('/').pop(),
      data: () => getData(),
      ref,
    }),
  };
  return ref;
}

const mockDb = mock(() => ({
  collection: (name: string) => ({
    doc: (id: string) => {
      if (name === 'listings') {
        const ref = makeDocRef(`listings/${id}`, () => listingDocData);
        (ref as Record<string, unknown>).collection = (sub: string) => ({
          doc: (offerId: string) =>
            makeDocRef(`listings/${id}/${sub}/${offerId}`, () => offerDocsById[offerId] ?? null),
          where: (_f: string, _op: string, _v: unknown) => ({
            get: async () => ({
              docs: Object.entries(offerDocsById)
                .filter(([, d]) => d.status === 'open')
                .map(([offerId, d]) => ({
                  id: offerId,
                  data: () => d,
                  ref: makeDocRef(`listings/${id}/${sub}/${offerId}`, () => d),
                })),
            }),
          }),
        });
        return ref;
      }
      // users
      const userRef = makeDocRef(`${name}/${id}`, () => null);
      (userRef as Record<string, unknown>).collection = (sub: string) => ({
        doc: (scanId: string) => makeDocRef(`${name}/${id}/${sub}/${scanId}`, () => null),
      });
      return userRef;
    },
  }),
  batch: () => ({
    set: (ref: { path: string }, data: DocData) => batchOps.push({ op: 'set', path: ref.path, data }),
    update: (ref: { path: string }, data: DocData) => batchOps.push({ op: 'update', path: ref.path, data }),
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
mock.module('../../lib/firebase/admin', () => ({ db: mockDb, adminStorage: () => ({ bucket: () => ({}) }) }));
mock.module('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    increment: (n: number) => ({ _increment: n }),
  },
}));

const { POST: ACCEPT } = await import('../../app/api/listings/[id]/offers/[offerId]/accept/route');
const { POST: DECLINE } = await import('../../app/api/listings/[id]/offers/[offerId]/decline/route');

const LISTING_ID = 'listingABC1234';
const SCAN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeParams(offerId: string) {
  return { params: Promise.resolve({ id: LISTING_ID, offerId }) };
}

function req(body: unknown) {
  return new Request(`http://localhost/api/listings/${LISTING_ID}/offers/offer-1/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SHIP_FROM = {
  name: 'Jae Bird',
  street1: '1 Main St',
  city: 'Columbus',
  state: 'OH',
  zip: '43004',
};

beforeEach(() => {
  mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'owner-1' }));
  mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
  mockBatchCommit.mockClear();
  batchOps.length = 0;
  listingDocData = {
    ownerUid: 'owner-1',
    scanId: SCAN_ID,
    status: 'active',
    offerCount: 3,
  };
  offerDocsById = {
    offer1234567: { retailerUid: 'ret-1', storeName: 'Uptown', amountUsd: 12, status: 'open' },
    offer2234567: { retailerUid: 'ret-2', storeName: 'Plato', amountUsd: 9, status: 'open' },
    offer3234567: { retailerUid: 'ret-3', storeName: 'Depop', amountUsd: 7, status: 'declined' },
  };
});

describe('POST /api/listings/[id]/offers/[offerId]/accept', () => {
  it('401 when unauthenticated', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    const res = await ACCEPT(req({ fulfillment: 'dropoff' }), makeParams('offer1234567'));
    expect(res.status).toBe(401);
  });

  it('404 for non-owner', async () => {
    listingDocData = { ...listingDocData!, ownerUid: 'someone-else' };
    const res = await ACCEPT(req({ fulfillment: 'dropoff' }), makeParams('offer1234567'));
    expect(res.status).toBe(404);
  });

  it('409 when listing is not active', async () => {
    listingDocData = { ...listingDocData!, status: 'accepted' };
    const res = await ACCEPT(req({ fulfillment: 'dropoff' }), makeParams('offer1234567'));
    expect(res.status).toBe(409);
  });

  it('409 when the offer is not open', async () => {
    const res = await ACCEPT(req({ fulfillment: 'dropoff' }), makeParams('offer3234567'));
    expect(res.status).toBe(409);
  });

  it('400 for ship fulfillment without a complete address', async () => {
    const res = await ACCEPT(
      req({ fulfillment: 'ship', shipFrom: { ...SHIP_FROM, zip: 'abc' } }),
      makeParams('offer1234567'),
    );
    expect(res.status).toBe(400);
  });

  it('dropoff accept declines other open offers and generates a code', async () => {
    const res = await ACCEPT(req({ fulfillment: 'dropoff' }), makeParams('offer1234567'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dropoffCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    // Accepted offer updated
    const acceptedOp = batchOps.find((o) => o.path.endsWith('/offers/offer1234567'));
    expect(acceptedOp!.data!.status).toBe('accepted');

    // The OTHER open offer auto-declined; already-declined one untouched
    const declinedOp = batchOps.find((o) => o.path.endsWith('/offers/offer2234567'));
    expect(declinedOp!.data!.status).toBe('declined');
    expect(batchOps.find((o) => o.path.endsWith('/offers/offer3234567'))).toBeUndefined();

    // Listing updated with acceptance metadata
    const listingOp = batchOps.find((o) => o.path === `listings/${LISTING_ID}`);
    expect(listingOp!.data!.status).toBe('accepted');
    expect(listingOp!.data!.acceptedRetailerUid).toBe('ret-1');
    expect(listingOp!.data!.acceptedAmountUsd).toBe(12);
    expect(listingOp!.data!.fulfillment).toBe('dropoff');
    expect(listingOp!.data!.dropoffCode).toBe(body.dropoffCode);

    // Closet mirror updated
    const mirrorOp = batchOps.find((o) => o.path.includes('/scans/'));
    expect(mirrorOp!.data!.listingStatus).toBe('accepted');
  });

  it('ship accept stores the shipFrom address and no dropoff code', async () => {
    const res = await ACCEPT(
      req({ fulfillment: 'ship', shipFrom: SHIP_FROM }),
      makeParams('offer1234567'),
    );
    expect(res.status).toBe(200);
    const listingOp = batchOps.find((o) => o.path === `listings/${LISTING_ID}`);
    expect(listingOp!.data!.fulfillment).toBe('ship');
    expect((listingOp!.data!.shipFrom as { zip: string }).zip).toBe('43004');
    expect(listingOp!.data!.dropoffCode).toBeUndefined();
  });
});

describe('POST /api/listings/[id]/offers/[offerId]/decline', () => {
  it('404 for non-owner', async () => {
    listingDocData = { ...listingDocData!, ownerUid: 'someone-else' };
    const res = await DECLINE(req({}), makeParams('offer1234567'));
    expect(res.status).toBe(404);
  });

  it('409 when offer already resolved', async () => {
    const res = await DECLINE(req({}), makeParams('offer3234567'));
    expect(res.status).toBe(409);
  });

  it('200 declines an open offer', async () => {
    const res = await DECLINE(req({}), makeParams('offer2234567'));
    expect(res.status).toBe(200);
    const op = batchOps.find((o) => o.path.endsWith('/offers/offer2234567'));
    expect(op!.data!.status).toBe('declined');
  });
});

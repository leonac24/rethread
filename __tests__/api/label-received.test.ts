import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import { verifyApprovedRetailer } from '../../lib/firebase/verify-retailer';
import { purchaseLabel, PARCEL_DEFAULTS } from '../../lib/shippo';

// Snapshot the real implementations so afterAll can undo the module mocks —
// bun module mocks are process-global and would break other test files otherwise.
const actualVerifyApprovedRetailer = verifyApprovedRetailer;
const actualPurchaseLabel = purchaseLabel;
const actualParcelDefaults = PARCEL_DEFAULTS;

// ─── Mock dependencies before importing the routes ───────────────────────────

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');

type Retailer = {
  uid: string; storeName: string; phone: string;
  street1: string; city: string; state: string; zip: string;
  lat: number | null; lng: number | null;
} | null;

const APPROVED_RETAILER: Retailer = {
  uid: 'ret-1',
  storeName: 'Uptown Cheapskate',
  phone: '614-555-0100',
  street1: '10 High St',
  city: 'Columbus',
  state: 'OH',
  zip: '43004',
  lat: 40,
  lng: -83,
};

const mockVerifyApprovedRetailer = mock(async (_req: Request): Promise<Retailer> => APPROVED_RETAILER);

const mockPurchaseLabel = mock(async () => ({
  labelUrl: 'https://shippo/label.pdf',
  trackingNumber: '1Z999',
  carrier: 'USPS',
}));

type DocData = Record<string, unknown>;
let listingDocData: DocData | null = null;

const updates: Array<{ path: string; data: DocData }> = [];
const batchOps: Array<{ op: string; path: string; data?: DocData }> = [];
const mockBatchCommit = mock(async () => {});

function makeDocRef(path: string, getData: () => DocData | null): DocData {
  const ref: DocData = {
    id: path.split('/').pop(),
    path,
    get: async () => ({
      exists: getData() !== null,
      data: () => getData(),
      ref,
    }),
    update: async (data: DocData) => {
      updates.push({ path, data });
    },
  };
  return ref;
}

const mockDb = mock(() => ({
  collection: (name: string) => ({
    doc: (id: string) => {
      if (name === 'listings') {
        return makeDocRef(`listings/${id}`, () => listingDocData);
      }
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
mock.module('../../lib/firebase/verify-retailer', () => ({
  verifyApprovedRetailer: mockVerifyApprovedRetailer,
}));
mock.module('../../lib/firebase/admin', () => ({ db: mockDb }));
mock.module('../../lib/shippo', () => ({
  purchaseLabel: mockPurchaseLabel,
  PARCEL_DEFAULTS: actualParcelDefaults,
}));
mock.module('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'SERVER_TS',
    increment: (n: number) => ({ _increment: n }),
  },
}));

const { POST: LABEL } = await import('../../app/api/listings/[id]/label/route');
const { POST: RECEIVED } = await import('../../app/api/listings/[id]/received/route');

afterAll(() => {
  mock.module('../../lib/firebase/verify-retailer', () => ({
    verifyApprovedRetailer: actualVerifyApprovedRetailer,
  }));
  mock.module('../../lib/shippo', () => ({
    purchaseLabel: actualPurchaseLabel,
    PARCEL_DEFAULTS: actualParcelDefaults,
  }));
});

const LISTING_ID = 'listingABC1234';
const SCAN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeParams(id = LISTING_ID) {
  return { params: Promise.resolve({ id }) };
}

function req() {
  return new Request(`http://localhost/api/listings/${LISTING_ID}/label`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

const SHIP_LISTING: DocData = {
  ownerUid: 'owner-1',
  scanId: SCAN_ID,
  status: 'accepted',
  acceptedRetailerUid: 'ret-1',
  acceptedAmountUsd: 12,
  fulfillment: 'ship',
  garment: { category: 'jeans', fibers: [] },
  shipFrom: { name: 'Jae', street1: '1 Main St', city: 'Columbus', state: 'OH', zip: '43004' },
};

beforeEach(() => {
  mockVerifyApprovedRetailer.mockImplementation(async () => APPROVED_RETAILER);
  mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
  mockPurchaseLabel.mockClear();
  mockPurchaseLabel.mockImplementation(async () => ({
    labelUrl: 'https://shippo/label.pdf',
    trackingNumber: '1Z999',
    carrier: 'USPS',
  }));
  mockBatchCommit.mockClear();
  updates.length = 0;
  batchOps.length = 0;
  listingDocData = { ...SHIP_LISTING };
});

describe('POST /api/listings/[id]/label', () => {
  it('403 when not an approved retailer', async () => {
    mockVerifyApprovedRetailer.mockImplementation(async () => null);
    const res = await LABEL(req(), makeParams());
    expect(res.status).toBe(403);
  });

  it('404 when the deal belongs to another retailer', async () => {
    listingDocData = { ...SHIP_LISTING, acceptedRetailerUid: 'ret-2' };
    const res = await LABEL(req(), makeParams());
    expect(res.status).toBe(404);
  });

  it('409 for dropoff deals', async () => {
    listingDocData = { ...SHIP_LISTING, fulfillment: 'dropoff' };
    const res = await LABEL(req(), makeParams());
    expect(res.status).toBe(409);
  });

  it('409 when a label already exists', async () => {
    listingDocData = { ...SHIP_LISTING, shipping: { labelUrl: 'x', trackingNumber: 'y', carrier: 'z' } };
    const res = await LABEL(req(), makeParams());
    expect(res.status).toBe(409);
  });

  it('400 when the customer address is missing', async () => {
    const { shipFrom: _omit, ...rest } = SHIP_LISTING;
    listingDocData = rest;
    const res = await LABEL(req(), makeParams());
    expect(res.status).toBe(400);
  });

  it('502 when Shippo fails, listing untouched', async () => {
    mockPurchaseLabel.mockImplementation(async () => {
      throw new Error('Shippo returned no rates.');
    });
    const res = await LABEL(req(), makeParams());
    expect(res.status).toBe(502);
    expect(updates).toHaveLength(0);
  });

  it('200 purchases a label from the customer to the store and stores it', async () => {
    const res = await LABEL(req(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shipping.trackingNumber).toBe('1Z999');

    // from = customer, to = store
    const [from, to, category] = mockPurchaseLabel.mock.calls[0] as unknown as [
      { name: string }, { name: string }, string | null,
    ];
    expect(from.name).toBe('Jae');
    expect(to.name).toBe('Uptown Cheapskate');
    expect(category).toBe('jeans');

    const update = updates.find((u) => u.path === `listings/${LISTING_ID}`);
    expect((update!.data.shipping as { labelUrl: string }).labelUrl).toBe('https://shippo/label.pdf');
  });
});

describe('POST /api/listings/[id]/received', () => {
  it('403 when not an approved retailer', async () => {
    mockVerifyApprovedRetailer.mockImplementation(async () => null);
    const res = await RECEIVED(req(), makeParams());
    expect(res.status).toBe(403);
  });

  it('404 for another retailer\'s deal', async () => {
    listingDocData = { ...SHIP_LISTING, acceptedRetailerUid: 'ret-2' };
    const res = await RECEIVED(req(), makeParams());
    expect(res.status).toBe(404);
  });

  it('409 when the deal is not in accepted state', async () => {
    listingDocData = { ...SHIP_LISTING, status: 'completed' };
    const res = await RECEIVED(req(), makeParams());
    expect(res.status).toBe(409);
  });

  it('200 completes the deal, records the final amount, updates the mirror', async () => {
    const res = await RECEIVED(req(), makeParams());
    expect(res.status).toBe(200);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    const listingOp = batchOps.find((o) => o.path === `listings/${LISTING_ID}`);
    expect(listingOp!.data!.status).toBe('completed');
    expect(listingOp!.data!.finalAmountUsd).toBe(12);

    const mirrorOp = batchOps.find((o) => o.path.includes('/scans/'));
    expect(mirrorOp!.data!.listingStatus).toBe('completed');
  });
});

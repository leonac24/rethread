import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the routes ───────────────────────────

let pendingDocs: Array<{ id: string; data: Record<string, unknown> }> = [];
let userDocData: Record<string, unknown> | null = null;

const updates: Array<{ path: string; data: Record<string, unknown> }> = [];

const mockDb = mock(() => ({
  collection: (_name: string) => ({
    where: (_f: string, _op: string, _v: unknown) => ({
      get: async () => ({
        docs: pendingDocs.map((d) => ({ id: d.id, data: () => d.data })),
      }),
    }),
    doc: (uid: string) => ({
      path: `users/${uid}`,
      get: async () => ({
        exists: userDocData !== null,
        data: () => userDocData,
      }),
      update: async (data: Record<string, unknown>) => {
        updates.push({ path: `users/${uid}`, data });
      },
    }),
  }),
}));

mock.module('../../lib/firebase/admin', () => ({ db: mockDb, adminStorage: () => ({ bucket: () => ({}) }), storageBucketName: () => 'test-bucket' }));

const { GET } = await import('../../app/api/admin/retailers/route');
const { POST } = await import('../../app/api/admin/retailers/[uid]/approve/route');

function makeParams(uid: string) {
  return { params: Promise.resolve({ uid }) };
}

function postReq() {
  return new Request('http://localhost/api/admin/retailers/u1/approve', { method: 'POST' });
}

beforeEach(() => {
  pendingDocs = [];
  userDocData = null;
  updates.length = 0;
});

describe('GET /api/admin/retailers', () => {
  it('lists pending applications with store details, never emails-only users', async () => {
    pendingDocs = [
      {
        id: 'uid-1',
        data: {
          email: 'store@example.com',
          role: 'retailer',
          retailer: {
            storeName: 'Uptown Cheapskate',
            street1: '10 High St',
            city: 'Columbus',
            state: 'OH',
            zip: '43004',
            phone: '614-555-0100',
            status: 'pending',
            appliedAt: { toMillis: () => 1_700_000_000_000 },
          },
        },
      },
    ];
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].uid).toBe('uid-1');
    expect(body.applications[0].storeName).toBe('Uptown Cheapskate');
    expect(body.applications[0].appliedAt).toBe(1_700_000_000_000);
  });

  it('returns an empty list when nothing is pending', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).applications).toEqual([]);
  });
});

describe('POST /api/admin/retailers/[uid]/approve', () => {
  it('400 for an invalid uid', async () => {
    const res = await POST(postReq(), makeParams('bad/uid'));
    expect(res.status).toBe(400);
  });

  it('404 when the user does not exist or has no retailer application', async () => {
    userDocData = { role: 'user' };
    const res = await POST(postReq(), makeParams('uid-1'));
    expect(res.status).toBe(404);
  });

  it('200 flips a pending application to approved', async () => {
    userDocData = { role: 'retailer', retailer: { storeName: 'Uptown', status: 'pending' } };
    const res = await POST(postReq(), makeParams('uid-1'));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].path).toBe('users/uid-1');
    expect(updates[0].data['retailer.status']).toBe('approved');
  });

  it('200 idempotently for an already-approved retailer without writing', async () => {
    userDocData = { role: 'retailer', retailer: { storeName: 'Uptown', status: 'approved' } };
    const res = await POST(postReq(), makeParams('uid-1'));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });
});

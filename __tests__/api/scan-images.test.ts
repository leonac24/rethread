import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock dependencies before importing the route ────────────────────────────

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request): Promise<{ uid: string } | null> => ({ uid: 'user-1' }));

const saves: Array<{ path: string; size: number }> = [];
const mockSave = mock(async (_buf: Buffer, _opts: unknown) => {});
let makePublicFails = false;
const mockBucket = mock((_name?: string) => ({
  name: 'demo-bucket.appspot.com',
  file: (path: string) => ({
    save: async (buf: Buffer, opts: unknown) => {
      saves.push({ path, size: buf.length });
      await mockSave(buf, opts);
    },
    makePublic: async () => {
      if (makePublicFails) throw new Error('uniform bucket-level access');
    },
  }),
}));

mock.module('../../lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIp: mockGetClientIp,
}));
mock.module('../../lib/firebase/verify-token', () => ({
  verifyBearerToken: mockVerifyBearerToken,
}));
mock.module('../../lib/firebase/admin', () => ({
  adminStorage: () => ({ bucket: mockBucket }),
  storageBucketName: () => 'demo-bucket.appspot.com',
}));

const { POST } = await import('../../app/api/scan/[id]/images/route');

const SCAN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TINY_JPEG = `data:image/jpeg;base64,${Buffer.from('fake-jpeg-bytes').toString('base64')}`;

function makeParams(id = SCAN_ID) {
  return { params: Promise.resolve({ id }) };
}

function req(body: unknown) {
  return new Request(`http://localhost/api/scan/${SCAN_ID}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'user-1' }));
  mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
  saves.length = 0;
  makePublicFails = false;
});

describe('POST /api/scan/[id]/images', () => {
  it('401 when unauthenticated', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    const res = await POST(req({ images: [TINY_JPEG] }), makeParams());
    expect(res.status).toBe(401);
  });

  it('400 for invalid scan id', async () => {
    const res = await POST(req({ images: [TINY_JPEG] }), makeParams('nope'));
    expect(res.status).toBe(400);
  });

  it('400 for non-data-URL entries', async () => {
    const res = await POST(req({ images: ['https://evil.example/x.jpg'] }), makeParams());
    expect(res.status).toBe(400);
  });

  it('400 for more than 4 images', async () => {
    const res = await POST(req({ images: Array(5).fill(TINY_JPEG) }), makeParams());
    expect(res.status).toBe(400);
  });

  it('uploads under the caller uid and returns public GCS URLs', async () => {
    const res = await POST(req({ images: [TINY_JPEG, TINY_JPEG] }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imageUrls).toHaveLength(2);
    expect(body.imageUrls[0]).toBe(
      `https://storage.googleapis.com/demo-bucket.appspot.com/scans/user-1/${SCAN_ID}/0.jpg`,
    );
    expect(saves.map((s) => s.path)).toEqual([
      `scans/user-1/${SCAN_ID}/0.jpg`,
      `scans/user-1/${SCAN_ID}/1.jpg`,
    ]);
  });

  it('falls back to firebase download-token URLs when makePublic is blocked', async () => {
    makePublicFails = true;
    const res = await POST(req({ images: [TINY_JPEG] }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imageUrls[0]).toStartWith(
      'https://firebasestorage.googleapis.com/v0/b/demo-bucket.appspot.com/o/scans%2Fuser-1%2F',
    );
    expect(body.imageUrls[0]).toContain('alt=media&token=');
  });
});

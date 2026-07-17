import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import * as realGemini from '../../lib/google/gemini';

// Snapshot the real module so afterAll can undo the global module mock.
const geminiSnapshot = { ...realGemini };

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request): Promise<{ uid: string } | null> => ({ uid: 'user-1' }));

const EVALUATION = {
  brand: 'Miu Miu',
  category: 'polo',
  color: 'navy',
  condition: 'good' as const,
  resale: { low_usd: 45, high_usd: 70, confidence: 'high' as const, factors: ['Miu Miu resells strongly'] },
};
const mockEvaluate = mock(async (_images: unknown, _garment: unknown) => ({ ...EVALUATION }));

let scanDocData: Record<string, unknown> | null = null;
const updates: Array<Record<string, unknown>> = [];
let storedFiles: Array<{ download: () => Promise<[Buffer]> }> = [];

const mockDb = mock(() => ({
  collection: (_name: string) => ({
    doc: (_uid: string) => ({
      collection: (_sub: string) => ({
        doc: (_scanId: string) => ({
          get: async () => ({ exists: scanDocData !== null, data: () => scanDocData }),
          update: async (data: Record<string, unknown>) => {
            updates.push(data);
          },
        }),
      }),
    }),
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
  db: mockDb,
  adminStorage: () => ({
    bucket: (_name?: string) => ({
      getFiles: async (_opts: unknown) => [storedFiles],
    }),
  }),
  storageBucketName: () => 'test-bucket',
}));
mock.module('firebase-admin/firestore', () => ({
  FieldValue: { serverTimestamp: () => 'SERVER_TS', increment: (n: number) => ({ _increment: n }) },
}));
mock.module('../../lib/google/gemini', () => ({
  ...geminiSnapshot,
  evaluateResaleFromImages: mockEvaluate,
}));

const { POST } = await import('../../app/api/user/scans/[scanId]/evaluate/route');

afterAll(() => {
  mock.module('../../lib/google/gemini', () => geminiSnapshot);
});

const SCAN_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeParams(scanId = SCAN_ID) {
  return { params: Promise.resolve({ scanId }) };
}

function req() {
  return new Request(`http://localhost/api/user/scans/${SCAN_ID}/evaluate`, { method: 'POST' });
}

beforeEach(() => {
  mockVerifyBearerToken.mockImplementation(async () => ({ uid: 'user-1' }));
  mockCheckRateLimit.mockImplementation(() => ({ allowed: true }));
  mockEvaluate.mockClear();
  mockEvaluate.mockImplementation(async () => ({ ...EVALUATION }));
  updates.length = 0;
  scanDocData = { result: { garment: { brand: undefined, fibers: [] }, cost: {} } };
  storedFiles = [
    { download: async () => [Buffer.from('img-0')] },
    { download: async () => [Buffer.from('img-1')] },
  ];
});

describe('POST /api/user/scans/[scanId]/evaluate', () => {
  it('401 when unauthenticated', async () => {
    mockVerifyBearerToken.mockImplementation(async () => null);
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(401);
  });

  it('404 when the scan is not in the caller closet', async () => {
    scanDocData = null;
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(404);
  });

  it('409 when no photos are stored', async () => {
    storedFiles = [];
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(409);
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('evaluates from photos and persists appraisal + corrected garment identity', async () => {
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resale.low_usd).toBe(45);
    expect(body.garment.brand).toBe('Miu Miu');

    // Images passed as base64
    const [images] = mockEvaluate.mock.calls[0] as unknown as [Array<{ data: string }>];
    expect(images).toHaveLength(2);
    expect(images[0].data).toBe(Buffer.from('img-0').toString('base64'));

    // Persisted with dot-path updates
    expect(updates).toHaveLength(1);
    expect(updates[0]['result.cost.resale']).toEqual(EVALUATION.resale);
    expect(updates[0]['result.garment.brand']).toBe('Miu Miu');
    expect(updates[0].resaleEvaluatedAt).toBe('SERVER_TS');
  });

  it('502 when Gemini fails, nothing persisted', async () => {
    mockEvaluate.mockImplementation(async () => {
      throw new Error('Gemini down');
    });
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(502);
    expect(updates).toHaveLength(0);
  });
});

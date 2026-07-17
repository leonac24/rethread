import { describe, it, expect, mock, beforeEach, afterAll } from 'bun:test';
import * as realGemini from '../../lib/google/gemini';

// Snapshot the real module so afterAll can undo the global module mock.
const geminiSnapshot = { ...realGemini };

const mockCheckRateLimit = mock((_ip: string) => ({ allowed: true }));
const mockGetClientIp = mock((_req: Request) => '1.2.3.4');
const mockVerifyBearerToken = mock(async (_req: Request): Promise<{ uid: string } | null> => ({ uid: 'user-1' }));

const ANALYSIS = {
  garment: {
    brand: 'Miu Miu',
    category: 'polo',
    color: 'navy',
    condition: 'good' as const,
    origin: 'Italy',
    fibers: [{ material: 'cotton', percentage: 100 }],
  },
  cost: {
    dye_pollution_score: 5,
    confidence: 'high' as const,
    reasoning: 'Reactive dye on cotton.',
    dye_type: 'synthetic reactive dye',
    disposal_co2_kg: 1.2,
    disposal_landfill_years: 4,
    disposal_note: 'Cotton decomposes but releases methane.',
  },
  landfill: {
    summary: 'Mostly biodegradable.',
    microplastics: 'None — all-natural fibers.',
    methane: 'Methane over 1-5 years.',
    dye_runoff: 'Reactive dye runoff possible.',
    breakdown_years: '1-5 years',
  },
  resale: { low_usd: 45, high_usd: 70, confidence: 'high' as const, factors: ['Miu Miu resells strongly'] },
};
const mockAnalyze = mock(async (_images: unknown, _opts: unknown) => structuredClone(ANALYSIS));

const FTI = { score: 42, year: 2024, brand: 'Miu Miu', url: 'https://wikirate.org/x' };
const mockFti = mock(async (_brand: string) => FTI);

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
  analyzeGarment: mockAnalyze,
}));
mock.module('../../lib/wikirate', () => ({
  getFashionTransparencyScore: mockFti,
  formatFtiContext: () => '',
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
  mockAnalyze.mockClear();
  mockAnalyze.mockImplementation(async () => structuredClone(ANALYSIS));
  mockFti.mockClear();
  mockFti.mockImplementation(async () => FTI);
  updates.length = 0;
  scanDocData = {
    result: {
      garment: { brand: undefined, fibers: [{ material: 'polyester', percentage: 100 }], category: 'shirt' },
      cost: { water_liters: 16, co2_kg: 2.1 },
    },
  };
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
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('runs the super call and persists the whole refreshed breakdown', async () => {
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resale.low_usd).toBe(45);
    expect(body.garment.brand).toBe('Miu Miu');

    // Images passed as base64
    const [images] = mockAnalyze.mock.calls[0] as unknown as [Array<{ data: string }>];
    expect(images).toHaveLength(2);
    expect(images[0].data).toBe(Buffer.from('img-0').toString('base64'));

    expect(updates).toHaveLength(1);
    const u = updates[0];

    // Eco cost recomputed from the corrected fibers/category:
    // 100% cotton, "polo" → default 400 g garment → 4000 L water, 2.4 kg CO2.
    const cost = u['result.cost'] as Record<string, unknown>;
    expect(cost.water_liters).toBe(4000);
    expect(cost.co2_kg).toBe(2.4);
    expect(cost.dye_pollution_score).toBe(5);
    expect(cost.resale).toEqual(ANALYSIS.resale);

    // Corrected identity, landfill, and FTI all persisted together.
    expect(u['result.garment.brand']).toBe('Miu Miu');
    expect(u['result.garment.origin']).toBe('Italy');
    expect(u['result.garment.fibers']).toEqual(ANALYSIS.garment.fibers);
    expect(u['result.landfill_impact']).toEqual(ANALYSIS.landfill);
    expect(u['result.fti']).toEqual(FTI);
    expect(u.resaleEvaluatedAt).toBe('SERVER_TS');
  });

  it('keeps prior fibers when the photos yield none', async () => {
    mockAnalyze.mockImplementation(async () => ({
      ...structuredClone(ANALYSIS),
      garment: { ...structuredClone(ANALYSIS.garment), fibers: [], category: null },
    }));
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(200);

    const u = updates[0];
    // Prior 100% polyester shirt: 225 g → water 71 * 0.225 ≈ 16, co2 9.5 * 0.225 ≈ 2.14.
    const cost = u['result.cost'] as Record<string, unknown>;
    expect(cost.water_liters).toBe(16);
    expect(u['result.garment.fibers']).toBeUndefined();
  });

  it('502 when Gemini fails, nothing persisted', async () => {
    mockAnalyze.mockImplementation(async () => {
      throw new Error('Gemini down');
    });
    const res = await POST(req(), makeParams());
    expect(res.status).toBe(502);
    expect(updates).toHaveLength(0);
  });
});

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ScanResult } from '../types/garment';
import { createFakeRedis } from './helpers/fake-redis';

// ─── Stub transitive @/ dependencies before importing scan-store ──────────────
const mockLog = { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) };
mock.module('../lib/logger', () => ({ log: mockLog }));
mock.module('../lib/config', () => ({
  SCAN_TTL_MS: 30 * 60 * 1000,
  MAX_SCAN_BYTES: 1_000_000,
  RATE_LIMIT: 5,
  RATE_WINDOW_MS: 60_000,
  MAX_UPLOAD_FILES: 5,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  BRAND_CACHE_TTL_MS: 60 * 60 * 1000,
  GEMINI_TIMEOUT_MS: 20_000,
  BIGQUERY_TIMEOUT_MS: 10_000,
  SHIPPO_TIMEOUT_MS: 20_000,
}));

const fake = createFakeRedis();
mock.module('../lib/redis', () => ({ redis: () => fake }));

const { saveScanResult, getScanById, recordOutcome } = await import('../lib/scan-store');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScanResult(overrides?: Partial<ScanResult>): ScanResult {
  return {
    id: crypto.randomUUID(),
    garment: {
      fibers: [{ material: 'cotton', percentage: 100 }],
      origin: 'Bangladesh',
      category: 'shirt',
    },
    cost: {
      water_liters: 2700,
      co2_kg: 2.1,
      dye_pollution_score: 4,
      confidence: 'high',
      reasoning: 'Standard cotton shirt estimate.',
      disposal_co2_kg: 0.5,
      disposal_landfill_years: 20,
      disposal_note: 'Cotton takes ~20 years to decompose in landfill.',
    },
    routes: [
      { kind: 'repair', name: 'Tailor', address: '1 St', distance_km: 0.3, accepts_item: true },
      { kind: 'resale', name: 'Thrift', address: '2 St', distance_km: 0.8, accepts_item: true },
      { kind: 'donation', name: 'Charity', address: '3 St', distance_km: 1.2, accepts_item: null },
    ],
    ...overrides,
  };
}

// ─── saveScanResult + getScanById ─────────────────────────────────────────────

describe('saveScanResult + getScanById', () => {
  it('saves to in-memory store and retrieves by id', async () => {
    const result = makeScanResult();
    const id = await saveScanResult('label text', result);
    expect(id).toBe(result.id);

    const retrieved = await getScanById(id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(id);
    expect(retrieved!.text).toBe('label text');
    expect(retrieved!.result.garment.category).toBe('shirt');
  });

  it('returns null for unknown id', async () => {
    const fakeId = crypto.randomUUID();
    const result = await getScanById(fakeId);
    expect(result).toBeNull();
  });

  it('throws on invalid UUID format', async () => {
    await expect(getScanById('not-a-uuid')).rejects.toThrow('Invalid scan ID format');
  });

  it('throws on path traversal attempt', async () => {
    await expect(getScanById('../../../etc/passwd')).rejects.toThrow('Invalid scan ID format');
  });

  it('preserves all cost fields including disposal on round-trip', async () => {
    const result = makeScanResult();
    const id = await saveScanResult('ocr text', result);
    const retrieved = await getScanById(id);

    expect(retrieved!.result.cost.water_liters).toBe(2700);
    expect(retrieved!.result.cost.disposal_co2_kg).toBe(0.5);
    expect(retrieved!.result.cost.disposal_landfill_years).toBe(20);
    expect(retrieved!.result.cost.disposal_note).toBe('Cotton takes ~20 years to decompose in landfill.');
  });

  it('stores with the scan TTL', async () => {
    const result = makeScanResult();
    await saveScanResult('', result);
    const expiresAt = fake.store.get(`scan:${result.id}`)!.expiresAt!;
    expect(expiresAt - Date.now()).toBeGreaterThan(29 * 60 * 1000);
  });

  it('discards malformed stored content (shape validation)', async () => {
    const id = crypto.randomUUID();
    await fake.set(`scan:${id}`, { garbage: true });
    expect(await getScanById(id)).toBeNull();
  });
});

// ─── recordOutcome ────────────────────────────────────────────────────────────

describe('recordOutcome', () => {
  it('records an outcome on a known scan', async () => {
    const result = makeScanResult();
    const id = await saveScanResult('', result);

    const { conflict, stored } = await recordOutcome(id, 'repair');
    expect(conflict).toBe(false);
    expect(stored!.outcome).toBe('repair');
    expect(stored!.outcomeAt).toBeGreaterThan(0);
  });

  it('returns stored: null for unknown scan', async () => {
    const { conflict, stored } = await recordOutcome(crypto.randomUUID(), 'donate');
    expect(stored).toBeNull();
    expect(conflict).toBe(false);
  });

  it('returns conflict: true if outcome already set', async () => {
    const result = makeScanResult();
    const id = await saveScanResult('', result);

    await recordOutcome(id, 'repair');
    const second = await recordOutcome(id, 'donate');

    expect(second.conflict).toBe(true);
    expect(second.stored!.outcome).toBe('repair'); // first outcome preserved
  });

  it('persists outcome so getScanById reflects it', async () => {
    const result = makeScanResult();
    const id = await saveScanResult('', result);
    await recordOutcome(id, 'list');

    const retrieved = await getScanById(id);
    expect(retrieved!.outcome).toBe('list');
  });

  it('accepts all valid outcome actions', async () => {
    for (const action of ['throw_away', 'repair', 'list', 'donate'] as const) {
      const result = makeScanResult();
      const id = await saveScanResult('', result);
      const { stored } = await recordOutcome(id, action);
      expect(stored!.outcome).toBe(action);
    }
  });

  it('first writer wins when two outcomes race', async () => {
    const result = makeScanResult();
    const id = await saveScanResult('', result);

    const [a, b] = await Promise.all([recordOutcome(id, 'repair'), recordOutcome(id, 'donate')]);
    expect([a.conflict, b.conflict].sort()).toEqual([false, true]);
    expect(a.stored!.outcome).toBe(b.stored!.outcome);
  });

  it('throws on invalid UUID', async () => {
    await expect(recordOutcome('bad-id', 'repair')).rejects.toThrow('Invalid scan ID format');
  });
});

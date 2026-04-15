import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { ScanResult } from '../types/garment';

// ─── Stub transitive @/ dependencies before importing scan-store ──────────────
const mockLog = { info: mock(() => {}), warn: mock(() => {}), error: mock(() => {}) };
mock.module('../lib/logger', () => ({ log: mockLog }));
mock.module('../lib/config', () => ({
  SCAN_TTL_MS: 30 * 60 * 1000,
  MAX_SCAN_BYTES: 1_000_000,
  RATE_LIMIT: 5,
  RATE_WINDOW_MS: 60_000,
  MAX_TRACKED_IPS: 10_000,
  MAX_UPLOAD_FILES: 5,
  MAX_FILE_BYTES: 10 * 1024 * 1024,
  BRAND_CACHE_TTL_MS: 60 * 60 * 1000,
  GEMINI_TIMEOUT_MS: 20_000,
  BIGQUERY_TIMEOUT_MS: 10_000,
}));

// Stub fs/promises so tests don't hit the real filesystem
const mockWriteFile = mock(async () => {});
const mockReadFile = mock(async (_path: string) => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
const mockUnlink = mock(async () => {});
const mockMkdir = mock(async () => {});

mock.module('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  unlink: mockUnlink,
  mkdir: mockMkdir,
}));

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

  it('writes to disk via writeFile', async () => {
    mockWriteFile.mockClear();
    const result = makeScanResult();
    await saveScanResult('', result);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it('falls back to disk (mockReadFile) for a cache-miss scenario', async () => {
    // getScanById on a UUID not in the in-memory map will attempt disk read
    // our mockReadFile throws ENOENT, so it returns null
    const missId = crypto.randomUUID();
    const result = await getScanById(missId);
    expect(result).toBeNull();
  });

  it('discards corrupt disk content (shape validation)', async () => {
    const corruptId = crypto.randomUUID();
    mockReadFile.mockImplementationOnce(async () => JSON.stringify({ garbage: true }));
    const result = await getScanById(corruptId);
    expect(result).toBeNull();
    expect(mockUnlink).toHaveBeenCalled();
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

  it('throws on invalid UUID', async () => {
    await expect(recordOutcome('bad-id', 'repair')).rejects.toThrow('Invalid scan ID format');
  });
});

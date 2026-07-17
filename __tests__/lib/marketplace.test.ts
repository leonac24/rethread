import { describe, it, expect } from 'bun:test';
import { haversineKm, roundCoord, generateDropoffCode, FIRESTORE_ID_RE } from '../../lib/marketplace';

describe('haversineKm', () => {
  it('measures one degree of longitude at the equator as ~111.19 km', () => {
    expect(Math.abs(haversineKm(0, 0, 0, 1) - 111.19)).toBeLessThan(0.5);
  });

  it('returns 0 for identical points', () => {
    expect(haversineKm(43.65, -79.38, 43.65, -79.38)).toBe(0);
  });
});

describe('roundCoord', () => {
  it('rounds to two decimals (~1.1 km precision)', () => {
    expect(roundCoord(43.65789)).toBe(43.66);
    expect(roundCoord(-79.38123)).toBe(-79.38);
  });
});

describe('generateDropoffCode', () => {
  it('produces 6 chars from the unambiguous alphabet', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateDropoffCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    }
  });

  it('is not constant', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateDropoffCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('FIRESTORE_ID_RE', () => {
  it('accepts Firestore auto-ids', () => {
    expect(FIRESTORE_ID_RE.test('abcDEF12345')).toBe(true);
    expect(FIRESTORE_ID_RE.test('Nk9YB2wq1XcT4rZ8pLm0')).toBe(true);
  });

  it('rejects path traversal and empty strings', () => {
    expect(FIRESTORE_ID_RE.test('a/b')).toBe(false);
    expect(FIRESTORE_ID_RE.test('')).toBe(false);
    expect(FIRESTORE_ID_RE.test('..')).toBe(false);
  });
});

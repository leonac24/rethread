import { describe, it, expect } from 'bun:test';
import { specId } from '@/lib/registry';
import type { Fiber } from '@/types/garment';

describe('specId', () => {
  const cottonPoly: Fiber[] = [
    { material: 'cotton', percentage: 60 },
    { material: 'polyester', percentage: 40 },
  ];

  const cottonPolyReversed: Fiber[] = [
    { material: 'polyester', percentage: 40 },
    { material: 'cotton', percentage: 60 },
  ];

  it('is deterministic — same inputs produce the same id', () => {
    const a = specId('tops', cottonPoly, 'China', 'nike');
    const b = specId('tops', cottonPoly, 'China', 'nike');
    expect(a).toBe(b);
  });

  it('fiber order does not change the id', () => {
    const a = specId('tops', cottonPoly, 'China', 'nike');
    const b = specId('tops', cottonPolyReversed, 'China', 'nike');
    expect(a).toBe(b);
  });

  it('brandSlug changes the id', () => {
    const a = specId('tops', cottonPoly, 'China', 'nike');
    const b = specId('tops', cottonPoly, 'China', 'adidas');
    expect(a).not.toBe(b);
  });

  it('id differs when brandSlug is present vs absent', () => {
    const withBrand = specId('tops', cottonPoly, 'China', 'nike');
    const withoutBrand = specId('tops', cottonPoly, 'China');
    expect(withBrand).not.toBe(withoutBrand);
  });

  it('origin is case-insensitive', () => {
    const lower = specId('tops', cottonPoly, 'china', 'nike');
    const upper = specId('tops', cottonPoly, 'CHINA', 'nike');
    const mixed = specId('tops', cottonPoly, 'China', 'nike');
    expect(lower).toBe(upper);
    expect(lower).toBe(mixed);
  });

  it('id is exactly 16 hex characters', () => {
    const id = specId('tops', cottonPoly, 'China', 'nike');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('null category and null origin are handled', () => {
    const id = specId(null, cottonPoly, null);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('empty fibers array is handled', () => {
    const id = specId('tops', [], 'China');
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });
});

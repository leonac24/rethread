import { describe, expect, test } from 'bun:test';
import { computeGarmentScore, gradeForScore } from '@/lib/score/garment';
import { originTier } from '@/lib/score/origin-tiers';

describe('gradeForScore', () => {
  test('grade bands', () => {
    expect(gradeForScore(80)).toBe('A');
    expect(gradeForScore(79.9)).toBe('B');
    expect(gradeForScore(65)).toBe('B');
    expect(gradeForScore(64.9)).toBe('C');
    expect(gradeForScore(50)).toBe('C');
    expect(gradeForScore(49.9)).toBe('D');
    expect(gradeForScore(35)).toBe('D');
    expect(gradeForScore(34.9)).toBe('F');
  });
});

describe('originTier', () => {
  test('ukraine is not tier 1 (substring false positive guard)', () => {
    expect(originTier('ukraine')).toBeNull();
  });

  test('made in portugal is tier 1', () => {
    expect(originTier('made in portugal')).toBe(1);
  });

  test('Made in CHINA is tier 3 (case-insensitive)', () => {
    expect(originTier('Made in CHINA')).toBe(3);
  });
});

describe('computeGarmentScore', () => {
  const linenTee = {
    category: 't-shirt',
    fibers: [{ material: 'linen', percentage: 100 }],
    origin: 'portugal',
    dyeRisk: 3,
  };
  const polyBlendTee = {
    category: 't-shirt',
    fibers: [
      { material: 'polyester', percentage: 60 },
      { material: 'cotton', percentage: 37 },
      { material: 'elastane', percentage: 3 },
    ],
    origin: 'china',
    dyeRisk: 8,
  };

  test('returns 0-100 score and matching grade', () => {
    const s = computeGarmentScore(linenTee);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(100);
    expect(s.grade).toBe(gradeForScore(s.score));
  });

  test('low-impact garment outscores high-impact garment', () => {
    expect(computeGarmentScore(linenTee).score).toBeGreaterThan(
      computeGarmentScore(polyBlendTee).score,
    );
  });

  test('mono-natural beats elastane blend on endOfLife', () => {
    const a = computeGarmentScore(linenTee).subScores.endOfLife;
    const b = computeGarmentScore(polyBlendTee).subScores.endOfLife;
    expect(a).toBeGreaterThan(b);
  });

  test('missing brand yields null brand sub-score and renormalized weights', () => {
    const s = computeGarmentScore(linenTee);
    expect(s.subScores.brand).toBeNull();
    const { materials, manufacturing, endOfLife } = s.subScores;
    const expected =
      ((materials as number) * 0.4 + (manufacturing as number) * 0.25 + endOfLife * 0.15) / 0.8;
    expect(Math.abs(s.score - expected)).toBeLessThan(0.06);
  });

  test('brand record feeds brand sub-score', () => {
    const s = computeGarmentScore({
      ...linenTee,
      brandDims: { transparency: 80, laborSupplyChain: 60 },
    });
    expect(s.subScores.brand).toBe(70);
  });

  test('unknown origin and no dye risk -> manufacturing null, still scores', () => {
    const s = computeGarmentScore({
      category: 't-shirt',
      fibers: [{ material: 'cotton', percentage: 100 }],
      origin: null,
    });
    expect(s.subScores.manufacturing).toBeNull();
    expect(s.score).toBeGreaterThan(0);
  });

  test('inferred fibers degrade confidence to low', () => {
    const s = computeGarmentScore({
      ...linenTee,
      provenance: { fibers: 'inferred', origin: 'stated', category: 'stated' },
    });
    expect(s.confidence).toBe('low');
  });

  test('NaN dyeRisk yields finite score and manufacturing equals origin-only score', () => {
    const s = computeGarmentScore({ ...linenTee, dyeRisk: NaN });
    expect(Number.isFinite(s.score)).toBe(true);
    // portugal is tier 1 -> originScore = 85; NaN dyeRisk is ignored so manufacturing = 85
    expect(s.subScores.manufacturing).toBe(85);
  });

  test('lycra endOfLife penalty: 95% cotton / 5% lycra scores lower than 100% cotton', () => {
    const pure = computeGarmentScore({
      category: 't-shirt',
      fibers: [{ material: 'cotton', percentage: 100 }],
      origin: null,
    }).subScores.endOfLife;
    const withLycra = computeGarmentScore({
      category: 't-shirt',
      fibers: [{ material: 'cotton', percentage: 95 }, { material: 'lycra', percentage: 5 }],
      origin: null,
    }).subScores.endOfLife;
    expect(withLycra).toBeLessThan(pure);
  });
});

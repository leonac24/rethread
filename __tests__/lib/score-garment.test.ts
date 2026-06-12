import { describe, expect, test } from 'bun:test';
import { computeGarmentScore, gradeForScore } from '@/lib/score/garment';

describe('gradeForScore', () => {
  test('grade bands', () => {
    expect(gradeForScore(80)).toBe('A');
    expect(gradeForScore(79.9)).toBe('B');
    expect(gradeForScore(65)).toBe('B');
    expect(gradeForScore(50)).toBe('C');
    expect(gradeForScore(35)).toBe('D');
    expect(gradeForScore(34.9)).toBe('F');
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
});

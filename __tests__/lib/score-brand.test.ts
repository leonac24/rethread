import { describe, expect, test } from 'bun:test';
import { updateProductImpact, computeBrandScore, kappaForStatus, slugifyBrand } from '@/lib/score/brand';

describe('updateProductImpact', () => {
  test('no evidence returns baseline', () => {
    expect(updateProductImpact({ baseline: 60, kappa: 150, n: 0, sum: 0 })).toBe(60);
  });
  test('verified brand (high kappa) barely moves on one bad scan', () => {
    const v = updateProductImpact({ baseline: 70, kappa: 150, n: 1, sum: 10 });
    expect(v).toBeGreaterThan(69);
  });
  test('new brand (low kappa) moves fast', () => {
    const v = updateProductImpact({ baseline: 50, kappa: 15, n: 15, sum: 15 * 90 });
    expect(v).toBe(70); // (15*50 + 1350) / 30
  });
});

describe('kappaForStatus', () => {
  test('ladder', () => {
    expect(kappaForStatus('verified')).toBe(150);
    expect(kappaForStatus('claimed')).toBe(75);
    expect(kappaForStatus('unclaimed')).toBe(15);
  });
});

describe('computeBrandScore', () => {
  test('weighted blend 40/30/30', () => {
    const { score, grade } = computeBrandScore({ productImpact: 50, transparency: 100, laborSupplyChain: 100 });
    expect(score).toBe(80);
    expect(grade).toBe('A');
  });
});

describe('slugifyBrand', () => {
  test('normalizes punctuation and case', () => {
    expect(slugifyBrand('H&M')).toBe('h-m');
    expect(slugifyBrand('H & M')).toBe('h-m');
    expect(slugifyBrand("Levi's")).toBe('levi-s');
    expect(slugifyBrand('  Uniqlo  ')).toBe('uniqlo');
  });
  test('strips diacritics', () => {
    expect(slugifyBrand('Désigual')).toBe('desigual');
  });
});

// Brand score: 3 dimensions. Scans update ONLY productImpact, via a
// κ-weighted Bayesian prior — established brands need more evidence to move.
import { gradeForScore, type Grade } from '@/lib/score/garment';
import type { BrandStatus } from '@/types/brand';

const W = { productImpact: 0.4, transparency: 0.3, laborSupplyChain: 0.3 };

export function kappaForStatus(status: BrandStatus): number {
  return status === 'verified' ? 150 : status === 'claimed' ? 75 : 15;
}

export function updateProductImpact(d: { baseline: number; kappa: number; n: number; sum: number }): number {
  return (d.kappa * d.baseline + d.sum) / (d.kappa + d.n);
}

export function computeBrandScore(dims: { productImpact: number; transparency: number; laborSupplyChain: number }): { score: number; grade: Grade } {
  const score = Math.round(
    (dims.productImpact * W.productImpact + dims.transparency * W.transparency + dims.laborSupplyChain * W.laborSupplyChain) * 10,
  ) / 10;
  return { score, grade: gradeForScore(score) };
}

export function slugifyBrand(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

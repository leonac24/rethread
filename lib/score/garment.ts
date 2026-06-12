// Deterministic Rethread Garment Score. Pure module — no I/O.
// Materials is benchmarked against a 50/50 cotton-poly reference garment of the
// same category so grades are intra-category fair (a linen tee is graded as a tee).
import { computeFiberImpact } from '@/lib/fiber-impact';
import { originScore } from '@/lib/score/origin-tiers';
import type { Fiber } from '@/types/garment';

export type Provenance = 'stated' | 'inferred';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export type GarmentScoreInput = {
  category: string | null;
  fibers: Fiber[];
  origin: string | null;
  dyeRisk?: number; // 1 (clean) – 10 (worst), from Gemini
  brandDims?: { transparency: number; laborSupplyChain: number };
  provenance?: { fibers: Provenance; origin: Provenance; category: Provenance; brand?: Provenance };
};

export type GarmentScore = {
  score: number;
  grade: Grade;
  subScores: {
    materials: number;
    manufacturing: number | null;
    brand: number | null;
    endOfLife: number;
  };
  confidence: 'high' | 'medium' | 'low';
};

const WEIGHTS = { materials: 0.4, manufacturing: 0.25, brand: 0.2, endOfLife: 0.15 };
const REFERENCE_BLEND: Fiber[] = [
  { material: 'cotton', percentage: 50 },
  { material: 'polyester', percentage: 50 },
];

const NATURALS = new Set(['cotton', 'organic_cotton', 'linen', 'hemp', 'wool', 'silk', 'cashmere', 'down']);
const RECYCLED = new Set(['recycled_polyester', 'recycled_nylon']);

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export function gradeForScore(score: number): Grade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  if (score >= 35) return 'D';
  return 'F';
}

// 50 = equal to reference; halving impact +25, doubling -25 (log2 scale).
function benchmarked(actual: number, benchmark: number): number {
  if (actual <= 0) return 50;
  return clamp(50 + 25 * Math.log2(benchmark / actual));
}

// Adapts to the real computeFiberImpact API which returns { water_liters, co2_kg, coverage }.
function materialsScore(fibers: Fiber[], category: string | null): number {
  const actual = computeFiberImpact(fibers, category);
  const bench = computeFiberImpact(REFERENCE_BLEND, category);
  return clamp(
    (benchmarked(actual.water_liters, bench.water_liters) +
      benchmarked(actual.co2_kg, bench.co2_kg)) /
      2,
  );
}

function manufacturingScore(origin: string | null, dyeRisk?: number): number | null {
  const o = originScore(origin);
  const d = (dyeRisk != null && Number.isFinite(dyeRisk)) ? clamp(100 - ((dyeRisk - 1) * 100) / 9) : null;
  if (o === null && d === null) return null;
  if (o === null) return d;
  if (d === null) return o;
  return (o + d) / 2;
}

function endOfLifeScore(fibers: Fiber[]): number {
  if (!fibers.length) return 40;
  const norm = (m: string) => m.toLowerCase().replace(/\s+/g, '_');
  const naturalPct = fibers
    .filter((f) => NATURALS.has(norm(f.material)))
    .reduce((s, f) => s + f.percentage, 0);
  const recycledPct = fibers
    .filter((f) => RECYCLED.has(norm(f.material)))
    .reduce((s, f) => s + f.percentage, 0);
  const elastanePct = fibers
    .filter((f) => norm(f.material) === 'elastane' || norm(f.material) === 'spandex' || norm(f.material) === 'lycra')
    .reduce((s, f) => s + f.percentage, 0);
  const dominant = Math.max(...fibers.map((f) => f.percentage));

  let score: number;
  if (naturalPct >= 95) score = 90;     // mono-natural: compostable/recyclable
  else if (dominant >= 95) score = 55;  // mono-synthetic: mechanically recyclable
  else score = 40;                      // blends resist recycling
  score += Math.min(15, recycledPct * 0.15); // credit recycled content
  if (elastanePct > 2) score -= 15;    // elastane contaminates recycling streams
  return clamp(score);
}

export function computeGarmentScore(input: GarmentScoreInput): GarmentScore {
  const subScores = {
    materials: materialsScore(input.fibers, input.category),
    manufacturing: manufacturingScore(input.origin, input.dyeRisk),
    brand: input.brandDims
      ? clamp((input.brandDims.transparency + input.brandDims.laborSupplyChain) / 2)
      : null,
    endOfLife: endOfLifeScore(input.fibers),
  };

  let weightSum = 0;
  let acc = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) {
    const v = subScores[key];
    if (v === null) continue;
    acc += v * WEIGHTS[key];
    weightSum += WEIGHTS[key];
  }
  // materials and endOfLife are always present, so weightSum is always > 0.
  const rawScore = acc / weightSum;
  const score = Math.round(rawScore * 10) / 10;

  const p = input.provenance;
  const confidence: GarmentScore['confidence'] =
    p?.fibers === 'inferred'
      ? 'low'
      : p?.origin === 'inferred' || p?.brand === 'inferred'
        ? 'medium'
        : 'high';

  // Grade is derived from the rounded score so displayed grade always matches displayed score.
  return { score, grade: gradeForScore(score), subScores, confidence };
}

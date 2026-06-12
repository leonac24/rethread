# Platform Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pivot rethread into a KBB/Carfax-style platform: deterministic garment scores, public brand pages with κ-weighted live scores, verified partners, and a QR referral loop.

**Architecture:** Pure-Gemini multimodal ingest replaces Vision OCR. Two pure scoring modules (`lib/score/garment.ts`, `lib/score/brand.ts`) keep ratings deterministic. Firestore gains `brands`, `partners`, `referrals`, `registry` collections, all written server-side via the Admin SDK. Spec: `docs/superpowers/specs/2026-06-12-platform-pivot-design.md`.

**Tech Stack:** Next.js 15 App Router, Bun, Firebase (Auth/Firestore/Admin), Gemini 2.5 Flash, Google Places, Tailwind v4, Recharts, `qrcode`.

**Conventions for every task:** run tests with `bun test`. Commit messages: succinct, all lowercase, conventional-commit style (`feat(score): ...`), **never any AI attribution or co-author trailers**. Follow `THEME.md` for any UI. Existing patterns to copy: API routes use `checkRateLimit`/`getClientIp` + `verifyBearerToken` (see `app/api/scan/[id]/outcome/route.ts`); client pages needing auth fetch APIs with a bearer token (see `app/profile/page.tsx`); Gemini calls use schema-enforced JSON with `withRetry` and `sanitizeForPrompt` (see `lib/google/gemini.ts`).

---

## Milestone 1 — scoring core + pure-Gemini ingest

### Task 1: Garment score engine

**Files:**
- Create: `lib/score/origin-tiers.ts`
- Create: `lib/score/garment.ts`
- Test: `__tests__/lib/score-garment.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/lib/score-garment.test.ts
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
    // score must equal weighted avg of remaining three sub-scores
    const { materials, manufacturing, endOfLife } = s.subScores;
    const expected =
      (materials * 0.4 + manufacturing * 0.25 + endOfLife * 0.15) / 0.8;
    expect(Math.abs(s.score - expected)).toBeLessThan(0.01);
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
```

- [ ] **Step 2: Run** `bun test __tests__/lib/score-garment.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/score/origin-tiers.ts
// Manufacturing-origin tiers by grid carbon intensity of textile-producing
// countries (proxy for production energy mix). Tier 1 = cleanest.
export type OriginTier = 1 | 2 | 3;

const TIER_1 = ['portugal', 'france', 'italy', 'spain', 'united kingdom', 'uk', 'sweden', 'canada', 'brazil', 'germany', 'austria', 'switzerland'];
const TIER_2 = ['turkey', 'usa', 'united states', 'mexico', 'japan', 'south korea', 'taiwan', 'thailand', 'sri lanka', 'tunisia', 'morocco', 'romania', 'egypt', 'jordan', 'peru', 'colombia', 'guatemala', 'honduras', 'dominican republic', 'madagascar', 'kenya', 'ethiopia'];
const TIER_3 = ['china', 'india', 'bangladesh', 'vietnam', 'pakistan', 'indonesia', 'cambodia', 'myanmar', 'south africa', 'philippines', 'laos'];

export function originTier(origin: string | null | undefined): OriginTier | null {
  if (!origin) return null;
  const o = origin.toLowerCase().trim();
  if (TIER_1.some((c) => o.includes(c))) return 1;
  if (TIER_2.some((c) => o.includes(c))) return 2;
  if (TIER_3.some((c) => o.includes(c))) return 3;
  return null; // unknown country — don't guess
}

export function originScore(origin: string | null | undefined): number | null {
  const tier = originTier(origin);
  if (tier === null) return null;
  return tier === 1 ? 85 : tier === 2 ? 60 : 35;
}
```

```ts
// lib/score/garment.ts
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

function materialsScore(fibers: Fiber[], category: string | null): number {
  const actual = computeFiberImpact(fibers, category);
  const bench = computeFiberImpact(REFERENCE_BLEND, category);
  return clamp((benchmarked(actual.water, bench.water) + benchmarked(actual.co2, bench.co2)) / 2);
}

function manufacturingScore(origin: string | null, dyeRisk?: number): number | null {
  const o = originScore(origin);
  const d = dyeRisk != null ? clamp(100 - ((dyeRisk - 1) * 100) / 9) : null;
  if (o === null && d === null) return null;
  if (o === null) return d;
  if (d === null) return o;
  return (o + d) / 2;
}

function endOfLifeScore(fibers: Fiber[]): number {
  if (!fibers.length) return 40;
  const norm = (m: string) => m.toLowerCase().replace(/\s+/g, '_');
  const naturalPct = fibers.filter((f) => NATURALS.has(norm(f.material))).reduce((s, f) => s + f.percentage, 0);
  const recycledPct = fibers.filter((f) => RECYCLED.has(norm(f.material))).reduce((s, f) => s + f.percentage, 0);
  const elastanePct = fibers.filter((f) => norm(f.material) === 'elastane' || norm(f.material) === 'spandex').reduce((s, f) => s + f.percentage, 0);
  const dominant = Math.max(...fibers.map((f) => f.percentage));

  let score: number;
  if (naturalPct >= 95) score = 90;          // mono-natural: compostable/recyclable
  else if (dominant >= 95) score = 55;       // mono-synthetic: mechanically recyclable
  else score = 40;                           // blends resist recycling
  score += Math.min(15, recycledPct * 0.15); // credit recycled content
  if (elastanePct > 2) score -= 15;          // elastane contaminates recycling streams
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
  const score = weightSum > 0 ? acc / weightSum : 0;

  const p = input.provenance;
  const confidence: GarmentScore['confidence'] =
    p?.fibers === 'inferred' ? 'low'
    : p?.origin === 'inferred' || p?.brand === 'inferred' ? 'medium'
    : 'high';

  return { score: Math.round(score * 10) / 10, grade: gradeForScore(score), subScores, confidence };
}
```

Check `computeFiberImpact`'s real signature in `lib/fiber-impact.ts:113` before wiring — adapt the two call sites to its actual `(fibers, category)` parameter shapes and `ImpactResult` field names (`water`/`co2` vs `water_liters`/`co2_kg`).

- [ ] **Step 4: Run** `bun test __tests__/lib/score-garment.test.ts` — expect PASS.
- [ ] **Step 5: Commit** — `feat(score): deterministic garment score engine`

### Task 2: Brand score engine

**Files:**
- Create: `lib/score/brand.ts`
- Create: `types/brand.ts`
- Test: `__tests__/lib/score-brand.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/lib/score-brand.test.ts
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
});
```

- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**

```ts
// types/brand.ts
import type { Grade } from '@/lib/score/garment';

export type BrandStatus = 'unclaimed' | 'claimed' | 'verified';

export type ProductImpactDim = { baseline: number; kappa: number; n: number; sum: number; current: number };

export type BrandRecord = {
  name: string;
  slug: string;
  aliases: string[];
  status: BrandStatus;
  claimedBy?: string;
  dossier: {
    summary: string;
    citations: { claim: string; url: string }[];
    certifications: string[];
    researchedAt: number; // epoch ms (Firestore Timestamp on the wire)
  };
  dims: { productImpact: ProductImpactDim; transparency: number; laborSupplyChain: number };
  fti?: { score: number; year: number; url: string };
  score: number;
  grade: Grade;
  updatedAt: number;
};
```

```ts
// lib/score/brand.ts
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
```

- [ ] **Step 4: Run** — expect PASS.
- [ ] **Step 5: Commit** — `feat(score): brand score engine with kappa-weighted evidence`

### Task 3: Pure-Gemini ingest

**Files:**
- Modify: `lib/google/gemini.ts` (add `ingestGarment`, delete `parseLabelWithGemini` + `analyzeGarmentImage` after rewire)
- Modify: `types/garment.ts` (add provenance to `Garment`)
- Delete: `lib/google/vision.ts`
- Test: `__tests__/lib/ingest.test.ts` (schema/shape only, Gemini fetch mocked)

- [ ] **Step 1: Add types.** In `types/garment.ts` add to `Garment`:

```ts
export type Provenance = 'stated' | 'inferred';

// add to Garment:
//   provenance?: { fibers: Provenance; origin: Provenance; category: Provenance; brand?: Provenance };
//   ingest_confidence?: 'high' | 'medium' | 'low';
```

- [ ] **Step 2: Write failing test** — mock `globalThis.fetch` to return a canned Gemini response and assert `ingestGarment` returns parsed fibers + provenance, and that a malformed first response triggers exactly one retry:

```ts
// __tests__/lib/ingest.test.ts
import { afterEach, describe, expect, test } from 'bun:test';
import { ingestGarment } from '@/lib/google/gemini';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

const geminiReply = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }), { status: 200 });

const valid = {
  fibers: [{ material: 'cotton', percentage: 100 }],
  origin: 'portugal', category: 't-shirt', brand: 'Uniqlo', color: null, condition: null,
  provenance: { fibers: 'stated', origin: 'stated', category: 'inferred', brand: 'stated' },
  confidence: 'high',
};

describe('ingestGarment', () => {
  test('parses schema-enforced response', async () => {
    globalThis.fetch = (async () => geminiReply(valid)) as typeof fetch;
    const g = await ingestGarment([Buffer.from('fake')], null);
    expect(g.fibers[0].material).toBe('cotton');
    expect(g.provenance.category).toBe('inferred');
  });

  test('retries once on malformed response, then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1 ? geminiReply('not json at all') : geminiReply(valid);
    }) as typeof fetch;
    const g = await ingestGarment([Buffer.from('fake')], null);
    expect(calls).toBe(2);
    expect(g.brand).toBe('Uniqlo');
  });
});
```

- [ ] **Step 3: Run** — expect FAIL (`ingestGarment` not exported).
- [ ] **Step 4: Implement `ingestGarment`** in `lib/google/gemini.ts`, reusing the file's existing request helper/auth/timeout/`withRetry` plumbing (read how `analyzeGarmentImage` at `lib/google/gemini.ts:449` sends image parts — copy that mechanism):
  - Signature: `ingestGarment(labelBuffers: Buffer[], garmentPhoto: Buffer | null): Promise<IngestResult>` where `IngestResult` = `Garment` fields + required `provenance` + `confidence`.
  - One multimodal request: all images as inline base64 parts + a text prompt:
    - "You are reading clothing care labels. Extract fibers (material + percentage, normalized to snake_case like recycled_polyester), country of origin, garment category, brand, and (if a garment photo is included) color and condition (poor|fair|good|excellent)."
    - "If a field is not printed on the label, infer your best guess from brand, category, and typical industry sourcing — and mark that field 'inferred' in provenance. Fields read directly off the label are 'stated'. Never leave provenance unset for a non-null field."
  - Enforce `responseSchema` (same generationConfig mechanism the file already uses) matching `IngestResult`.
  - On JSON-parse/schema failure: retry the call once; second failure throws.
  - Validate post-parse: percentages numeric and > 0, cap fibers at 8, run `sanitizeResponseText` on free-text fields.
- [ ] **Step 5: Run** — expect PASS.
- [ ] **Step 6: Commit** — `feat(ingest): single-call gemini multimodal ingest with provenance`

### Task 4: Rewire the scan pipeline

**Files:**
- Modify: `app/api/scan/route.ts`
- Modify: `types/garment.ts` (extend `ScanResult`)
- Modify: `lib/google/gemini.ts` (delete `parseLabelWithGemini`, `analyzeGarmentImage`)
- Delete: `lib/google/vision.ts`, remove `@google-cloud/vision` from `package.json`

- [ ] **Step 1: Extend `ScanResult`** in `types/garment.ts`:

```ts
import type { GarmentScore } from '@/lib/score/garment';
// add to ScanResult:
//   garment_score?: GarmentScore;
//   brand_page?: { slug: string; name: string; grade: string; score: number; status: string };
```

(`brand_page` is populated in Task 7; optional now so the type is stable.)

- [ ] **Step 2: Rewire `handleScan`** in `app/api/scan/route.ts`:
  - Replace the `[INGEST]` block (lines 136-182): one call `const ingest = await ingestGarment(labelBuffers, garmentPhotoBuffer)`; build `garment` from it (keep the same conditional-spread shape, now including `provenance` and `ingest_confidence`). Delete the Vision imports, the `texts`/`text` variable (pass `''` as the first arg to `saveScanResult` — check its usage at `lib/scan-store.ts:57` and keep its signature), the regex fallback, and the `parseLabelWithGemini` path.
  - Delete the `ftiPromise` + `getFashionTransparencyScore` import (WikiRate moves to seed-time in Task 6; `fti` leaves `ScanResult` population but stays in the type for stored old scans).
  - After `cost` resolves, compute the score:

```ts
const garment_score = computeGarmentScore({
  category: garment.category,
  fibers: garment.fibers,
  origin: garment.origin,
  dyeRisk: cost.dye_pollution_score,
  provenance: garment.provenance,
});
```

  - Add `garment_score` to `result`. Keep landfill + routes behavior unchanged.
- [ ] **Step 3: Delete dead code** — `lib/google/vision.ts`, the two replaced gemini functions, `bun remove @google-cloud/vision`. Grep for remaining imports of `vision`, `parseLabelWithGemini`, `analyzeGarmentImage`, `getFashionTransparencyScore` (the test routes `app/api/test-scan/route.ts` / `app/api/test-routes/route.ts` may import them — update or delete those test routes).
- [ ] **Step 4: Verify** — `bun test` (all green) and `bun run build` (compiles).
- [ ] **Step 5: Commit** — `feat(scan): pure-gemini pipeline with garment score`

### Task 5: Result page around the grade

**Files:**
- Modify: `components/result-view.tsx`
- Create: `components/grade-badge.tsx`
- Create: `components/score-breakdown.tsx`

- [ ] **Step 1: `GradeBadge`** — a reusable component: large grade letter in a circle, color by grade (A `#2e7d32`-family … F `#c62828`-family — pull exact palette from `THEME.md`), props `{ grade, score, size?: 'lg' | 'sm' }`. Used by results, brand pages, and the directory.
- [ ] **Step 2: `ScoreBreakdown`** — four horizontal bars (Materials / Manufacturing / Brand / End of Life) from `subScores`, null sub-scores rendered as "not enough data", plus a confidence chip; when `garment.provenance` marks a field `inferred`, show an "estimated" tag next to that fact (e.g. "Origin: Portugal · estimated").
- [ ] **Step 3: Restructure `result-view.tsx`** — grade hero at top (GradeBadge lg + one-line verdict, e.g. "Better than most t-shirts" when score ≥ 65, "Higher impact than typical" < 50), `ScoreBreakdown` next, then the existing footprint/donut/landfill sections unchanged below. Handle scans without `garment_score` (old stored scans) by simply omitting the hero.
- [ ] **Step 4: Verify** — `bun run build`; manual: `bun run dev`, run a scan with a label photo, confirm grade renders.
- [ ] **Step 5: Commit** — `feat(result): grade hero and score breakdown`

---

## Milestone 2 — brands

### Task 6: Brand data layer + seeding script

**Files:**
- Create: `lib/brands.ts`
- Create: `scripts/seed-brands.ts`
- Test: `__tests__/lib/brands.test.ts` (pure parts: alias matching)

- [ ] **Step 1: `lib/brands.ts`** (Admin SDK, server-only):

```ts
// lib/brands.ts
import { db } from '@/lib/firebase/admin';
import { computeBrandScore, kappaForStatus, slugifyBrand, updateProductImpact } from '@/lib/score/brand';
import type { BrandRecord } from '@/types/brand';
import { FieldValue } from 'firebase-admin/firestore';

export async function getBrand(slug: string): Promise<BrandRecord | null> {
  const snap = await db().collection('brands').doc(slug).get();
  return snap.exists ? (snap.data() as BrandRecord) : null;
}

export async function listBrands(): Promise<BrandRecord[]> {
  const snap = await db().collection('brands').orderBy('score', 'desc').limit(200).get();
  return snap.docs.map((d) => d.data() as BrandRecord);
}

// Resolve a Gemini-extracted brand name to a record: try slug as doc id,
// then alias match. Unmatched names are queued in brand_candidates for later.
export async function resolveBrand(name: string): Promise<BrandRecord | null> {
  const slug = slugifyBrand(name);
  if (!slug) return null;
  const direct = await getBrand(slug);
  if (direct) return direct;
  const byAlias = await db().collection('brands').where('aliases', 'array-contains', slug).limit(1).get();
  if (!byAlias.empty) return byAlias.docs[0].data() as BrandRecord;
  await db().collection('brand_candidates').doc(slug).set(
    { name, slug, seen: FieldValue.increment(1), lastSeenAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return null;
}

// Record one garment scan as evidence in a transaction; recompute productImpact + headline.
export async function recordScanEvidence(slug: string, garmentScore: number): Promise<void> {
  const ref = db().collection('brands').doc(slug);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const b = snap.data() as BrandRecord;
    const pi = { ...b.dims.productImpact, n: b.dims.productImpact.n + 1, sum: b.dims.productImpact.sum + garmentScore };
    pi.kappa = kappaForStatus(b.status);
    pi.current = updateProductImpact(pi);
    const { score, grade } = computeBrandScore({ productImpact: pi.current, transparency: b.dims.transparency, laborSupplyChain: b.dims.laborSupplyChain });
    tx.update(ref, { 'dims.productImpact': pi, score, grade, updatedAt: FieldValue.serverTimestamp() });
  });
}
```

Aliases are stored **slugified** (resolveBrand compares slug-to-slug). Unit-test `slugifyBrand` round-trips for the alias cases in Task 2's tests; the Firestore functions are covered by manual verification (emulator setup is out of scope).

- [ ] **Step 2: Seeding script** `scripts/seed-brands.ts`, run via `bun run scripts/seed-brands.ts` (needs the same env/service-account vars as the app — document at top of file):
  - Hardcode ~50 entries `{ name, aliases?: string[] }`: zara, h&m (aliases: hennes-mauritz), uniqlo, nike, adidas, shein, gap, old navy, levi's (aliases: levi-strauss), patagonia, the north face, lululemon, primark, forever 21, urban outfitters, american eagle, hollister, abercrombie & fitch, gucci, prada, louis vuitton, burberry, ralph lauren (aliases: polo-ralph-lauren), tommy hilfiger, calvin klein, under armour, puma, new balance, asos, boohoo, mango, banana republic, j.crew, madewell, everlane, reformation, carhartt, columbia, champion, hanes, fruit of the loom, victoria's secret, aerie, free people, anthropologie, dickies, wrangler, lee, guess, uniqlo... (dedupe; exactly 50 distinct).
  - Per brand, two Gemini calls (reuse the request helper from `lib/google/gemini.ts`; export it or duplicate minimally in the script):
    1. **Dossier (grounded):** Gemini with `tools: [{ google_search: {} }]`, prompt: "Research the clothing brand {name} for environmental and labor practices. Cover: sustainability commitments and progress, supply-chain transparency and disclosure depth, labor controversies or violations in the last 10 years, certifications (Fair Trade, B Corp, SA8000, GOTS, bluesign), typical materials. Cite a source URL for every factual claim." (No responseSchema — grounding and schema can't combine.)
    2. **Extraction (schema-enforced):** feed the dossier text, extract `{ summary: string (<=600 chars), citations: {claim, url}[], certifications: string[], transparency: number 0-100, laborSupplyChain: number 0-100, productImpactBaseline: number 0-100 }` with instructions: transparency reflects disclosure depth; laborSupplyChain reflects certifications minus controversies; productImpactBaseline reflects typical materials/manufacturing footprint.
  - Fetch FTI via `getFashionTransparencyScore` (`lib/wikirate.ts:127`); when present, override transparency = `round(0.5 * extracted + 0.5 * fti.score)` and store `fti` on the record.
  - Build the record: `status: 'unclaimed'`, `dims.productImpact = { baseline, kappa: 15, n: 0, sum: 0, current: baseline }` (κ recomputed from status on each evidence write), headline via `computeBrandScore`. Upsert by slug (idempotent re-runs). Log progress per brand; continue past single-brand failures and print a failure summary at the end.
- [ ] **Step 3: Run** `bun test` — green. (Script execution itself happens in Task 15 final checks.)
- [ ] **Step 4: Commit** — `feat(brands): brand data layer and gemini research seeding script`

### Task 7: Brand evidence in the scan pipeline + registry upsert

**Files:**
- Modify: `app/api/scan/route.ts`
- Create: `lib/registry.ts`
- Test: `__tests__/lib/registry.test.ts` (specId determinism)

- [ ] **Step 1: `lib/registry.ts`:**

```ts
// lib/registry.ts
// Internal evidence stream — no public UI in v1. One doc per garment "spec".
import { createHash } from 'node:crypto';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Fiber } from '@/types/garment';
import type { GarmentScore } from '@/lib/score/garment';

export function specId(category: string | null, fibers: Fiber[], origin: string | null, brandSlug?: string): string {
  const fiberKey = [...fibers]
    .sort((a, b) => a.material.localeCompare(b.material))
    .map((f) => `${f.material.toLowerCase()}:${f.percentage}`)
    .join(',');
  return createHash('sha1')
    .update(`${(category ?? '').toLowerCase()}|${fiberKey}|${(origin ?? '').toLowerCase()}|${brandSlug ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

export async function upsertRegistryEntry(args: {
  category: string | null; fibers: Fiber[]; origin: string | null; brandSlug?: string; score: GarmentScore;
}): Promise<void> {
  const id = specId(args.category, args.fibers, args.origin, args.brandSlug);
  await db().collection('registry').doc(id).set(
    {
      category: args.category, fibers: args.fibers, origin: args.origin,
      ...(args.brandSlug ? { brandSlug: args.brandSlug } : {}),
      score: args.score.score, grade: args.score.grade, subScores: args.score.subScores,
      scanCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}
```

Test: same inputs → same `specId` regardless of fiber order; brand changes the id.

- [ ] **Step 2: Wire into `handleScan`:** after ingest, `const brandRecord = garment.brand ? await resolveBrand(garment.brand).catch(() => null) : null`. Pass `brandDims: brandRecord ? { transparency: brandRecord.dims.transparency, laborSupplyChain: brandRecord.dims.laborSupplyChain } : undefined` into `computeGarmentScore` (never productImpact — circularity guard). Populate `result.brand_page` from `brandRecord` (slug, name, grade, score, status). After the result is saved, fire-and-forget (`.catch(log)`) `recordScanEvidence(brandRecord.slug, garment_score.score)` and `upsertRegistryEntry(...)` — neither may delay or fail the response.
- [ ] **Step 3: Run** `bun test` + `bun run build`.
- [ ] **Step 4: Commit** — `feat(scan): brand evidence loop and registry upsert`

### Task 8: Brand pages

**Files:**
- Create: `app/brands/page.tsx` (server component)
- Create: `app/brands/[slug]/page.tsx` (server component)
- Modify: `components/header-nav.tsx` (add Brands link)

- [ ] **Step 1: `/brands`** — server component calling `listBrands()`: search box (client-side filter), grid of cards with `GradeBadge sm`, name, status badge (`AI-researched` for unclaimed / `Claimed` / `Verified ✓`). Follow THEME.md and existing page composition (header/footer from `components/`).
- [ ] **Step 2: `/brands/[slug]`** — `getBrand(slug)` or `notFound()`. Layout: GradeBadge lg + name + status badge; three dimension bars (Product Impact "based on N scanned garments" using `dims.productImpact.n`, Transparency, Labor & Supply Chain); dossier summary; citations as a linked source list; certifications as chips; FTI line when present; "Is this your brand? Claim it" CTA linking `/partners/apply?brand={slug}`.
- [ ] **Step 3:** Add "Brands" to `components/header-nav.tsx`.
- [ ] **Step 4: Verify** — `bun run build`; with seeded data, pages render.
- [ ] **Step 5: Commit** — `feat(brands): public brand index and detail pages`

---

## Milestone 3 — business layer

### Task 9: Partner types, application API, apply page

**Files:**
- Create: `types/partner.ts`
- Create: `app/api/partners/apply/route.ts`
- Create: `app/api/partners/me/route.ts`
- Create: `app/partners/apply/page.tsx`

- [ ] **Step 1: Types:**

```ts
// types/partner.ts
export type PartnerType = 'repair' | 'resale' | 'donation' | 'recycler';
export type PartnerStatus = 'pending' | 'verified' | 'rejected';

export type PartnerRecord = {
  kind: 'partner' | 'brand_claim';
  businessName: string;
  type?: PartnerType;
  placeId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  brandSlug?: string;
  evidence: { links: string[]; text: string };
  discountPct: number; // default 5
  status: PartnerStatus;
  appliedAt: number;
  verifiedAt?: number;
};
```

- [ ] **Step 2: `POST /api/partners/apply`** — copy the auth/rate-limit pattern from `app/api/scan/[id]/outcome/route.ts`: `verifyBearerToken` required (401 otherwise), validate body (`kind`, `businessName` 2-100 chars, `type` in enum for partners, `brandSlug` must exist via `getBrand` for claims, ≤5 evidence links each `https://`, text ≤2000 chars), **status always server-set to `pending`**, `discountPct` clamped 0-20 default 5. For local partners with an `address`: geocode via the Places API (reuse the fetch/auth approach in `lib/google/places.ts` — Text Search, take top result's `place_id` + location; failure leaves placeId/lat/lng unset, application still accepted). Write to `partners/{uid}` (`create`-style: reject 409 if doc exists). `GET /api/partners/me` returns own doc or 404.
- [ ] **Step 3: `/partners/apply` page** — client component using the existing auth context (`lib/firebase/auth-context.tsx`): sign-in prompt when logged out; type toggle (local partner / brand claim, preselect brand from `?brand=` param); fields per Step 2; submits with bearer token; success state "Application received — we review within a few days"; if `GET /api/partners/me` returns a doc, show status instead of the form (link to dashboard when verified).
- [ ] **Step 4: Verify** — `bun run build`; manual: submit an application, see `pending` doc in Firestore.
- [ ] **Step 5: Commit** — `feat(partners): business applications and account linkage`

### Task 10: Referral issue API + QR on results

**Files:**
- Create: `lib/referrals.ts`
- Create: `app/api/referrals/route.ts`
- Create: `components/referral-qr.tsx`
- Modify: `components/result-view.tsx`, `package.json` (`bun add qrcode @types/qrcode`)
- Test: `__tests__/api/referrals.test.ts` (validation paths, store mocked) — follow the existing `__tests__/api` mocking style

- [ ] **Step 1: `lib/referrals.ts`:**

```ts
// lib/referrals.ts
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CODE_RE = /^[A-Za-z0-9_-]{8}$/;

export type ReferralStatus = 'issued' | 'redeemed' | 'expired';

export function newCode(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

export async function issueReferral(args: { partnerId: string; scanId: string; userId?: string; discountPct: number }) {
  const code = newCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + REFERRAL_TTL_MS);
  await db().collection('referrals').doc(code).create({
    ...args, status: 'issued', createdAt: FieldValue.serverTimestamp(), expiresAt,
  });
  return { code, expiresAt: expiresAt.toMillis() };
}

// Transactional redeem: only the matching verified partner, only once, only unexpired.
export async function redeemReferral(code: string, partnerUid: string): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'wrong_partner' | 'already_redeemed' | 'expired' }> {
  const ref = db().collection('referrals').doc(code);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, reason: 'not_found' as const };
    const r = snap.data()!;
    if (r.partnerId !== partnerUid) return { ok: false as const, reason: 'wrong_partner' as const };
    if (r.status === 'redeemed') return { ok: false as const, reason: 'already_redeemed' as const };
    if (r.expiresAt.toMillis() < Date.now()) return { ok: false as const, reason: 'expired' as const };
    tx.update(ref, { status: 'redeemed', redeemedAt: FieldValue.serverTimestamp() });
    return { ok: true as const };
  });
}
```

- [ ] **Step 2: `POST /api/referrals`** — rate-limited; body `{ scanId, partnerId }`; validate scanId via `getScanById`, partner exists + `status === 'verified'` + `kind === 'partner'`; `verifyBearerToken` optional (attach `userId` when present); respond `{ code, url: \`${origin}/redeem/${code}\`, discountPct, expiresAt }` (origin from the request URL).
- [ ] **Step 3: `ReferralQr` component** — props `{ scanId, partnerId, partnerName, discountPct }`: button "Get {discountPct}% off — show this at checkout" → POST → render QR via `import QRCode from 'qrcode'` `toDataURL(url, { width: 280, margin: 1 })` in a modal/expanded card with expiry date and the partner name. Handle API error with a retry message.
- [ ] **Step 4: Verify + commit** — `bun test`, `bun run build`; commit `feat(referrals): one-time qr discount codes`

### Task 11: Verified partners pinned in routes

**Files:**
- Modify: `types/garment.ts` (`RouteOption` gains `verified?: boolean; partnerId?: string; discountPct?: number`)
- Create: `lib/partner-routes.ts`
- Modify: `app/api/scan/route.ts`, `components/result-view.tsx`
- Test: `__tests__/lib/partner-routes.test.ts`

- [ ] **Step 1: `lib/partner-routes.ts`** — `applyVerifiedPartners(routes, partners, lat, lng)`: pure function (partners passed in, fetched by caller). For each route kind, find the nearest verified partner whose `type` maps to that kind (`recycler` counts for `donation`) within 25 km (haversine — reuse/extract the distance helper from `lib/google/places.ts`; if none exists there, implement haversine here). When found, replace that kind's organic option with `{ kind, name: businessName, address, distance_km, lat, lng, accepts_item: null, verified: true, partnerId, discountPct }`. Tests: replaces only matching kind, respects radius, picks nearest of two, leaves routes untouched when no partners.
- [ ] **Step 2: Wire into `handleScan`** — fetch verified partners once per request (`db().collection('partners').where('status','==','verified').where('kind','==','partner').get()`, wrapped in try/catch → empty list on failure; in-memory cache 5 min like `lib/scan-store.ts`'s cache pattern), apply after `prioritizeRoutesByCondition`. Skip when no coords.
- [ ] **Step 3: Result view** — route cards with `verified: true` get a "Rethread Verified ✓" badge and embed `ReferralQr`.
- [ ] **Step 4: Verify + commit** — `bun test`, build; commit `feat(routes): pin verified partners with referral qr`

### Task 12: Redeem page + confirm API

**Files:**
- Create: `app/api/referrals/[code]/route.ts` (GET status)
- Create: `app/api/referrals/[code]/redeem/route.ts` (POST confirm)
- Create: `app/redeem/[code]/page.tsx`

- [ ] **Step 1: GET** — validate `CODE_RE`, fetch referral + partner businessName; return `{ businessName, discountPct, status, expiresAt }` (compute `expired` from expiresAt for display; no user data exposed). 404 on unknown code.
- [ ] **Step 2: POST redeem** — `verifyBearerToken` required; caller's `partners/{uid}` must exist with `status 'verified'`; call `redeemReferral(code, uid)`; map reasons → 404 / 403 (`wrong_partner`) / 409 (`already_redeemed`) / 410 (`expired`); 200 on ok.
- [ ] **Step 3: Page `/redeem/[code]`** — client component, mobile-first (cashiers): loads GET; shows discount big ("Honor **5% off** — rethread referral") + business name + status. Signed-in matching partner sees **Confirm redemption** button → POST → success check screen. Signed-out: "Staff: sign in to confirm" + sign-in button. Invalid/used/expired codes render an unmistakable red state.
- [ ] **Step 4: Verify + commit** — manual loop: issue QR from a scan → open redeem URL → confirm as partner account → second confirm shows 409 state. Commit `feat(referrals): redeem flow with partner confirmation`

### Task 13: Partner dashboard

**Files:**
- Create: `app/api/partners/stats/route.ts`
- Create: `app/partners/dashboard/page.tsx`
- Modify: `components/header-nav.tsx` ("For Businesses" link → `/partners/apply`)

- [ ] **Step 1: Stats API** — auth required, own data only: query `referrals` where `partnerId == uid`; return `{ issued, redeemed, conversionPct, monthly: { month: 'YYYY-MM', issued, redeemed }[] (last 6), estimatedOwed: redeemed * PER_REDEMPTION_USD }`. Add `PER_REDEMPTION_USD = 0.75` to `lib/config.ts`.
- [ ] **Step 2: Dashboard page** — auth-gated client page (profile-page pattern): headline tiles (issued / redeemed / conversion / estimated owed), Recharts bar chart of monthly issued vs redeemed (Recharts is already used — follow the existing chart usage in the result view for theming), application-status banner when not yet verified.
- [ ] **Step 3: Verify + commit** — build + manual with the Task 12 test data. Commit `feat(partners): referral stats dashboard`

### Task 14: Verification standard page, landing, security rules

**Files:**
- Create: `app/verification/page.tsx`
- Modify: `app/page.tsx`, `components/header-nav.tsx`
- Create: `firestore.rules`

- [ ] **Step 1: `/verification`** — static page stating the standard: what "Rethread Verified" means for partners (resale/repair/donation/recycling practices, evidence reviewed manually, criteria list: legitimate resale/recycling operations, no landfill dumping of donations, transparent pricing) and for brands (affiliation proof, disclosure review). Status ladder explained (AI-researched → claimed → verified).
- [ ] **Step 2: Landing** — reposition `app/page.tsx` hero copy: "Check before you buy. Route it when you're done." Sub: scan a care label for an instant A-F impact grade; browse brand report cards; find verified places to repair, resell, or recycle — with a discount. Two CTAs: Scan a tag, Browse brands. Keep visual structure/theme; copy change + CTA only.
- [ ] **Step 3: `firestore.rules`** — client access: `users/*` own-doc (mirror existing console rules — read current rules from the Firebase console before writing, don't regress them); `brands` read-only; `partners/{uid}` read own; `referrals`, `registry`, `brand_candidates`, `outcomes` no client access (API-only). Note in file header: deploy with `firebase deploy --only firestore:rules`.
- [ ] **Step 4: Verify + commit** — build; commit `feat(platform): verification standard, landing reposition, firestore rules`

### Task 15: Final pass

- [ ] **Step 1:** `bun test` full suite green; `bun run build` clean; grep for dead imports (`vision`, `wikirate` outside seed script, `parseLabelWithGemini`).
- [ ] **Step 2:** Run `bun run scripts/seed-brands.ts` against the live project (needs env vars; expect ~50 brands, several minutes). Spot-check 3 brand pages for citation quality.
- [ ] **Step 3:** Update `README.md`: new positioning, pipeline diagram (Vision removed), new collections, brand/partner/referral features, seed script instructions.
- [ ] **Step 4:** Full e2e demo run: scan → grade → brand page link → partner pinned → QR → redeem → dashboard.
- [ ] **Step 5:** Commit `docs: readme for platform pivot` — then review the branch diff end to end.

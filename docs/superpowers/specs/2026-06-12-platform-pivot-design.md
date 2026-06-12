# Rethread Platform Pivot — Design Spec

**Date:** 2026-06-12
**Status:** Approved
**Goal:** Pivot rethread from an environmental-awareness demo into a "Kelly Blue Book / Carfax for clothes" platform, pitched at the GDG Solution Challenge (SDG 12). Bar: live-demoable end to end with a credible business model; not operationally complete (no payments, manual verification).

---

## 1. Overview

Three pillars, built on the existing scan pipeline:

1. **Rethread Garment Score** — a deterministic A–F / 0–100 rating computed per scan; the "blue book value" of a garment, used as a pre-purchase research tool (scan the tag in-store).
2. **Brand Scores & public brand pages** — a separate brand-level rating, seeded for 50 major brands by a Gemini research script, updated live by scan evidence via a κ-weighted prior. Brands can claim their pages.
3. **Verified partners & QR referral loop** — local resellers/recyclers/repair shops apply, get manually verified, appear pinned in scan-result routes, and confirm one-time QR discount codes at the register. Confirmed redemptions are the kickback billing basis.

What stays: closet, outcomes, landfill analysis, profile/rank, globe loading screen. The outcome routing is now the referral (revenue) surface.

What's removed: Google Cloud Vision OCR (replaced by pure-Gemini multimodal ingest), WikiRate live calls at scan time (FTI moves into brand records; see §4).

Deferred to phase 2: public garment registry UI, payments, self-serve verification, admin UI, affiliate brand alternatives.

---

## 2. Ingest — pure-Gemini single call

Replace the Vision OCR → Gemini parse → (optional) garment-image analysis chain in `app/api/scan/route.ts` with **one Gemini 2.5 Flash multimodal call**: all label photos + optional garment photo in, schema-enforced JSON out.

**Output schema (extends `Garment`):**

```ts
type Provenance = 'stated' | 'inferred';

type IngestResult = {
  fibers: Fiber[];
  origin: string | null;
  category: string | null;
  brand?: string;
  color?: string;
  condition?: GarmentCondition;
  provenance: {            // per-field: read off the tag vs Gemini's best guess
    fibers: Provenance;
    origin: Provenance;
    category: Provenance;
    brand?: Provenance;
  };
  confidence: 'high' | 'medium' | 'low';
};
```

- Gemini is instructed to infer missing fields (e.g., origin from brand + category norms) but must mark them `inferred`.
- Failure handling: retry once on schema-parse failure; then return a structured error to the client (no regex fallback — it needed raw OCR text).
- `lib/google/vision.ts` and the `@google-cloud/vision` dependency are removed.
- Prompt-injection hygiene from `lib/google/gemini.ts` (`sanitizeForPrompt`) carries over.

---

## 3. Rethread Garment Score

New pure module **`lib/score/garment.ts`** — no I/O, fully unit-testable.

**Input:** `{ category, fibers, origin, dyeRisk?, brandRecord? }`
**Output:**

```ts
type GarmentScore = {
  score: number;          // 0–100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  subScores: {
    materials: number;      // fiber LCA (water + CO2) normalized vs per-category benchmarks
    manufacturing: number;  // origin tier (transport + energy mix) + dye pollution score
    brand: number | null;   // from brand record's transparency + labor dims; null if no brand
    endOfLife: number;      // recyclability heuristic: mono-natural > mono-synthetic > blends; elastane penalty
  };
  confidence: 'high' | 'medium' | 'low'; // degraded when key inputs are inferred
};
```

- **Materials** uses the existing `lib/fiber-impact.ts` table; water and CO₂ are normalized against per-category benchmark constants (median expected impact for that category) so grades are intra-category fair.
- **Manufacturing** uses a small origin-tier table (country → energy-mix/transport tier, ~30 entries + default) plus the Gemini dye score when available.
- **Brand** reads the brand record's Transparency and Labor dimensions — never Product Impact (prevents feedback circularity, §4).
- Missing sub-scores are excluded and weights renormalized — never zero-filled.
- Weights: materials 0.40, manufacturing 0.25, brand 0.20, endOfLife 0.15 (renormalized when absent).
- Grade bands: A ≥ 80, B ≥ 65, C ≥ 50, D ≥ 35, F < 35.
- Deterministic by design — the pitch line is "Gemini parses, the rating is auditable math."

**Result page** (`components/result-view.tsx`): grade letter is the hero, sub-score breakdown beneath, inferred fields visibly marked ("origin estimated"), existing footprint/landfill content as supporting detail.

---

## 4. Brand Score & brand pages

### Model

New pure module **`lib/score/brand.ts`**. Three dimensions, each 0–100:

| Dimension | Evidence source | Updated by |
|---|---|---|
| Product Impact | research baseline + garment scans | scans (κ-weighted) |
| Transparency | FTI + disclosure depth from dossier | research / claims only |
| Labor & Supply Chain | certifications, controversies, commitments from dossier | research / claims only |

**Product Impact update (κ-weighted Bayesian prior):**

```
productImpact = (κ · baseline + Σ garmentScores) / (κ + n)
```

- `n` = scan count, `Σ garmentScores` = running sum (stored as aggregates, recomputed cheaply on each scan).
- κ by status: verified = 150, claimed = 75, unclaimed/new = 15. Big verified brands need ~150 scans of evidence to move as much as their established record; unknown locals move quickly.

**Headline brand score:** weighted blend — productImpact 0.40, transparency 0.30, laborSupplyChain 0.30. Same A–F bands as garments.

### Firestore: `brands/{brandId}`

```ts
{
  name: string;
  slug: string;               // doc id
  aliases: string[];          // normalization: "h&m", "h & m", "hennes & mauritz"
  status: 'unclaimed' | 'claimed' | 'verified';
  claimedBy?: string;         // business account uid
  dossier: {
    summary: string;
    citations: { claim: string; url: string }[];
    certifications: string[];
    researchedAt: Timestamp;
  };
  dims: {
    productImpact: { baseline: number; kappa: number; n: number; sum: number; current: number };
    transparency: number;
    laborSupplyChain: number;
  };
  fti?: { score: number; year: number; url: string };
  score: number;
  grade: string;
  updatedAt: Timestamp;
}
```

- Public read; writes server-side only (Admin SDK).
- **Scan-time brand resolution:** Gemini-extracted brand name → lowercase/strip-punctuation slug → match against slug + aliases. Match → record scan evidence (increment `n`, add to `sum`, recompute) and use record for garment Brand sub-score. No match → garment scored without brand sub-score; unknown brand names are recorded for later page creation (`brand_candidates` collection).
- WikiRate FTI is fetched at **seed/claim time** into the brand record, not live per scan (removes a scan-time dependency and latency).

### Pages

- **`/brands`** — public index: search, grade badges, status badges.
- **`/brands/[slug]`** — public page: grade hero, three dimension bars, dossier summary with citations, scan-evidence count ("based on N scanned garments"), status badge (`AI-researched · unclaimed` / `Claimed` / `Verified`), and a "claim this brand" CTA.

### Seeding script

**`scripts/seed-brands.ts`** (run locally, one-time): for each of ~50 hardcoded major brands — Gemini with Google Search grounding builds a research dossier → second schema-enforced call extracts structured metrics + citations → scored via `lib/score/brand.ts` → written to Firestore. Idempotent (upsert by slug).

---

## 5. Business accounts, applications, verification

One pipeline, two applicant types: **reseller/recycler/repair partner** and **brand claim**.

- Auth: existing Firebase Auth (Google OAuth). A business account is a user with a `partners/{uid}` doc (no custom claims needed in v1; role derived from doc existence).
- **`/partners/apply`** — sign in, choose type:
  - *Local partner:* business name, type (`repair | resale | donation | recycler`), address (resolved to a Google Place ID via Places API — this is how they match into scan-result routes), evidence (links, certifications, free text), agreed discount (default 5%).
  - *Brand claim:* pick an existing brand page (or request a new one), evidence of affiliation.
- Status: `pending → verified | rejected`. **Verification is manual in v1** — flipped in Firestore console. Criteria published on a public `/verification` page so "verified" is a stated standard.
- **`/partners/dashboard`** — for verified partners: issued vs redeemed referral counts, conversion rate, monthly Recharts chart, "estimated owed" line (configurable per-redemption rate, default $0.75). Pending applicants see application status.

### Firestore: `partners/{uid}`

```ts
{
  kind: 'partner' | 'brand_claim';
  businessName: string;
  type?: 'repair' | 'resale' | 'donation' | 'recycler';
  placeId?: string;
  address?: string;
  brandSlug?: string;          // for brand claims
  evidence: { links: string[]; text: string };
  discountPct: number;         // default 5
  status: 'pending' | 'verified' | 'rejected';
  appliedAt: Timestamp;
  verifiedAt?: Timestamp;
}
```

On brand-claim verification, the brand doc gets `status: 'claimed'` (or `'verified'`), `claimedBy: uid`, and κ updated.

---

## 6. QR referral loop

- **Issue:** on the scan result page, verified partners appear pinned above organic Places results with a badge and "Get 5% off — show this at checkout." Tap → `POST /api/referrals` creates `referrals/{code}` (code = short random id):

```ts
{
  partnerId: string;
  scanId: string;
  userId?: string;            // null for anonymous scanners
  discountPct: number;
  status: 'issued' | 'redeemed' | 'expired';
  createdAt: Timestamp;
  expiresAt: Timestamp;       // +7 days
  redeemedAt?: Timestamp;
}
```

  Client renders QR (add `qrcode` package) encoding `{origin}/redeem/{code}`.
- **Redeem:** cashier scans with any phone → `/redeem/[code]` shows business name + discount to honor. **Confirm redemption** button works only when the signed-in user is the matching verified partner (server-verified). Confirm → `status: 'redeemed'`. Expired/used codes render clearly invalid. A signed-out viewer sees "ask staff to sign in to confirm."
- **Anti-fraud in v1:** one-time use, 7-day expiry, partner-only confirmation. (Rate-limiting issuance per user via existing `lib/rate-limit.ts`.)
- No payments: business honors the discount at the register; kickback is invoiced against confirmed redemptions (the dashboard is the evidence).

### Route pinning

`lib/route-utils.ts` / Places flow: after fetching organic results, query verified partners by `type` matching the route kind, compute distance from user, pin any within a radius (~25 km) above organic results with `verified: true` flag. Organic results unchanged below.

---

## 7. Internal garment registry (evidence stream, no UI)

In the scan pipeline, after scoring: upsert `registry/{specId}` where `specId = hash(category | normalized fibers | origin | brandSlug?)`:

```ts
{ category, fibers, origin, brandSlug?, score, grade, subScores, scanCount, updatedAt }
```

No user data, no images, no public UI. Purpose: aggregate counts for the pitch ("N garments rated") and the phase-2 browsable registry. Also drives brand evidence aggregates (§4).

---

## 8. Security rules

- `brands`: public read; client write denied (server/Admin SDK only).
- `partners`: read own doc; create own application (status forced `pending`); status field never client-writable.
- `referrals`: no client reads/writes — all through API routes with token verification (issue: any scanner; redeem: matching verified partner only). Server checks, not rules-only.
- `registry`: no client access.
- Existing user/scan rules unchanged.

---

## 9. Landing & navigation

- `app/page.tsx` copy repositioned: "Check before you buy. Route it when you're done." Two entry points: scan a tag (research) and browse brands.
- Header nav adds Brands, For Businesses (→ `/partners/apply`), Verification standard.

---

## 10. Testing

- `lib/score/garment.ts` and `lib/score/brand.ts`: pure functions, full unit coverage (bun test) — grade bands, weight renormalization with missing inputs, κ update math, circularity guard (brand sub-score never reads productImpact).
- Brand name normalization/alias matching: unit tests.
- Referral lifecycle: issue → redeem → reject reuse/expiry/wrong-partner — API-level tests following existing `__tests__/api` patterns.
- Ingest: prompt/schema unit tests with mocked Gemini; manual e2e with real labels before the pitch.

---

## 11. Build order (implementation phases)

1. Scoring engines (`lib/score/*`) + tests — pure, no dependencies
2. Pure-Gemini ingest swap + provenance
3. Result page restructure around the grade
4. Brand data model + seeding script + brand pages
5. Business accounts: apply, dashboard, verification page
6. QR referral loop (issue, redeem, route pinning)
7. Registry upsert + landing/nav repositioning + security rules

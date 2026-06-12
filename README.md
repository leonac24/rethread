# Rethread

**The blue book for clothes. Scan a tag, get the grade, route it responsibly.**

Rethread turns a photo of a clothing care label into an auditable A–F score, surfaces a public brand report card backed by live scan evidence, and connects the user to verified local partners — repair shops, resellers, recyclers — with a one-time QR discount code confirmed at the register.

---

## What it does

1. **Scan a care label** — upload one or more photos of the care label (optionally the garment). One multimodal Gemini call reads all images, extracts fibers, origin, brand, and condition, and marks each field as `stated` (read from the tag) or `inferred` (Gemini's best guess). No Cloud Vision; no regex fallback.

2. **Get the grade** — a deterministic Rethread Score (0–100, A–F) is computed from four sub-scores: materials, manufacturing, brand, and end-of-life. Materials and manufacturing benchmarks are set against a 50/50 cotton-poly reference garment of the same category so grades are intra-category fair. Inferred fields lower confidence. The full sub-score breakdown and provenance markers are shown on the result page.

3. **See the brand report card** — 50 major brands are seeded via Gemini-with-grounding research (citations included). Brand scores update live from scan evidence via a κ-weighted Bayesian prior: verified brands need ~150 scans of counter-evidence to move as much as a newly-seen local brand needs 15. Brand pages are public; brands can claim and eventually verify their page.

4. **Route it** — verified local partners (repair / resale / donation / recycler) appear pinned above organic Google Places results with a "5% off — show at checkout" badge. Tap to generate a one-time QR code. The cashier scans it; the partner confirms on their dashboard. Confirmed redemptions are the billing basis.

5. **Closet and impact totals** — authenticated users build a closet of past scans with running CO₂ and water totals. Rank badges earn from Thread Rookie to Rethread Pro. Scan deletion reverses totals atomically.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Package manager | Bun |
| Styling | Tailwind CSS v4 |
| UI | React 19 |
| Animation | Framer Motion (`motion` v12) |
| Charts | Recharts (partner dashboard) |
| 3D | Three.js (point-cloud globe loading screen) |
| QR codes | qrcode |
| AI | Gemini 2.5 Flash (multimodal ingest, cost/landfill reasoning, brand research) |
| Maps | Google Maps & Places API (organic route finding) |
| Sustainability data | WikiRate REST API (FTI — seed/claim time only, not live per scan) |
| Auth | Firebase Authentication (Google OAuth) |
| Database | Firestore |
| Storage | Firebase Storage (scan images per user) |
| Hosting | Vercel + GCP service account |

---

## Architecture

```
  ┌─────────────┐       ┌──────────────────────┐       ┌────────────────────┐
  │   Browser   │──────▶│  POST /api/scan      │──────▶│  Gemini 2.5 Flash  │
  │  (upload)   │◀──────│  (rate-limited)      │◀──────│  (single multimod- │
  └─────────────┘       └──────────┬───────────┘       │   al ingest call)  │
                                   │                   └────────────────────┘
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
         ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐
         │ Gemini cost/ │  │Google Places │  │  brands collection  │
         │ landfill     │  │(organic rtes)│  │  (brand resolution  │
         │ reasoning    │  └──────────────┘  │   + scan evidence)  │
         └──────────────┘                   └────────────────────┘
                    │
                    ▼
         ┌──────────────────────────────────────────┐
         │  Deterministic score (lib/score/garment) │
         │  Brand evidence update + registry upsert │
         │  Verified partner pinning                │
         └──────────────────────────────────────────┘

  ┌─────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
  │   Browser   │──────▶│  POST /api/referrals │──────▶│  Firestore           │
  │  (QR issue) │◀──────│  GET  /redeem/[code] │◀──────│  referrals/{code}    │
  └─────────────┘       │  POST /redeem/confirm│       └──────────────────────┘
                        └──────────────────────┘
```

All API calls run server-side. The browser never holds a credential. Scan results are stored in `/tmp` with an in-memory cache (30-min TTL) and passed through `sessionStorage` so the result page loads instantly without a re-fetch.

### Ingest pipeline (one POST, parallel stages after ingest)

```
 photos ──▶ [1. Gemini multimodal ingest] ──▶ [2. cost + landfill + brand resolution + routes — parallel] ──▶ [3. score + pin + registry]
```

#### 1. Ingest

One Gemini 2.5 Flash multimodal call receives all label photos plus the optional garment photo. Returns structured JSON with per-field provenance (`stated | inferred`). Retries once on schema parse failure; returns a 422 to the client on second failure. `lib/google/gemini.ts` `sanitizeForPrompt` hygiene applies.

Output type:
```ts
type IngestResult = {
  fibers: Fiber[];
  origin: string | null;
  category: string | null;
  brand?: string;
  color?: string;
  condition?: 'poor' | 'fair' | 'good' | 'excellent';
  provenance: { fibers: Provenance; origin: Provenance; category: Provenance; brand?: Provenance };
  confidence: 'high' | 'medium' | 'low';
};
```

#### 2. Parallel stages

- **Cost** — `computeCost` (Gemini): dye pollution score (1–10) + environmental summary. Water and CO₂ from `lib/fiber-impact.ts` LCA lookup table (no AI; WaterFootprint.org + Textile Exchange data).
- **Landfill impact** — `computeLandfillImpact` (Gemini): fiber-aware microplastics, methane, dye runoff, breakdown years.
- **Brand resolution** — `resolveBrand`: slug + alias match against `brands` collection. Hit → supplies `transparency` and `laborSupplyChain` dimensions to the garment score; records scan evidence. Miss → queues slug in `brand_candidates`.
- **Routes** — `findRoutes` (Google Places): three parallel `searchText` requests, nearest result within 5 km per category.

#### 3. Score, pin, and record

- `computeGarmentScore` (pure deterministic, see Scoring section).
- `applyVerifiedPartners`: verified partners within ~25 km are pinned above organic routes.
- `recordScanEvidence` (fire-and-forget): increments brand `productImpact` via κ-weighted transaction.
- `upsertRegistryEntry` (fire-and-forget): upserts `registry/{specId}` aggregate.

---

## Scoring

### Garment score (`lib/score/garment.ts`)

Pure module, no I/O, fully unit-tested.

**Sub-scores and weights** (weights renormalized when a sub-score is absent):

| Sub-score | Weight | Source |
|---|---|---|
| Materials | 0.40 | Fiber LCA (water + CO₂) vs. 50/50 cotton-poly benchmark for the same category, log₂ scale |
| Manufacturing | 0.25 | Origin energy-mix/transport tier (~30 countries + default) averaged with dye pollution score |
| Brand | 0.20 | Brand record's `transparency` + `laborSupplyChain` averaged — never `productImpact` (circularity guard) |
| End of life | 0.15 | Mono-natural ≥ 95% → 90; mono-synthetic ≥ 95% → 55; blend → 40; recycled content +credit; elastane > 2% −15 |

**Grade bands:** A ≥ 80 · B ≥ 65 · C ≥ 50 · D ≥ 35 · F < 35

**Confidence:** degrades to `medium` when origin or brand is inferred; to `low` when fibers are inferred.

### Brand score (`lib/score/brand.ts`)

Three dimensions, each 0–100:

| Dimension | Weight | Updated by |
|---|---|---|
| Product Impact | 0.40 | Scan evidence via κ-weighted Bayesian prior |
| Transparency | 0.30 | Seed research + FTI score (seed/claim time only) |
| Labor & Supply Chain | 0.30 | Seed research (certifications, controversies) |

**κ-weighted update:**
```
productImpact.current = (κ · baseline + Σ garmentScores) / (κ + n)
```
κ by status: `verified` = 150, `claimed` = 75, `unclaimed` = 15.

Same A–F grade bands as garments.

---

## Firestore collections

| Collection | Purpose |
|---|---|
| `users/{uid}` + `scans/` | Auth user profile, closet scans, impact totals |
| `brands/{slug}` | Public brand report cards — public read, server write only |
| `partners/{uid}` | Business applications and verified partner records |
| `referrals/{code}` | One-time QR codes — server-only (issued, redeemed, expired) |
| `registry/{specId}` | Aggregate garment evidence stream — no user data, no UI yet |
| `brand_candidates/{slug}` | Unrecognized brands queued for later research |

---

## Business model

Verified partners pay nothing to apply or list. On each confirmed QR redemption (partner-confirmed at the register), rethread earns a per-redemption fee (default basis: $0.75/redemption). The partner dashboard shows issued vs. redeemed counts, conversion rate, and an "estimated owed" line as the invoice basis. Discounts are 5% by default (configurable per partner). No payments in v1 — kickback is invoiced against redemption evidence.

---

## Pages

| Route | Description |
|---|---|
| `/` | Landing — "Check before you buy. Route it when you're done." |
| `/scan` | Upload care label + optional garment photo |
| `/scanning` | Fires POST /api/scan; animated globe loading screen |
| `/result/[id]` | Grade hero, sub-score breakdown, footprint, routes, QR referral, outcome picker |
| `/brands` | Public brand index — search, grade badges, status badges |
| `/brands/[slug]` | Brand report card — grade, three dimension bars, dossier, scan evidence count, claim CTA |
| `/partners/apply` | Business application form (local partner or brand claim) |
| `/partners/dashboard` | Verified partner: referral stats, redemption chart; pending: application status |
| `/redeem/[code]` | Cashier view — discount to honor, partner-confirm button |
| `/verification` | Published verification standard (manual in v1) |
| `/closet/[scanId]` | Read-only closet scan detail |
| `/profile` | Avatar, rank badge, impact totals, closet grid |
| `/login` | Google sign-in via Firebase |

---

## Components

```
components/
├── camera-scan.tsx       # Upload UI: label + garment photos, compression, sessionStorage handoff
├── scanning-view.tsx     # Reads scan:pending; POSTs to /api/scan; routes to result
├── result-view.tsx       # Grade hero, sub-scores, footprint, landfill, routes, QR referral, outcome
├── outcome-section.tsx   # Outcome state machine; uploads images to Storage; POSTs outcome
├── referral-qr.tsx       # QR code display for verified partner routes
├── grade-badge.tsx       # A–F grade chip with color band
├── score-breakdown.tsx   # Sub-score bars with provenance markers
├── brand-grid.tsx        # Brand index cards
├── loading-screen.tsx    # Three.js point-cloud globe + blurb cycler (shared)
├── header.tsx / header-nav.tsx  # Auth-aware nav: Brands, For Businesses, Verification
└── footer.tsx            # Hidden on /scan and /scanning
```

---

## API routes

```
app/api/
├── scan/route.ts                    # POST — full pipeline; rate-limited (5 req/min/IP)
├── scan/[id]/route.ts               # GET — fetch stored scan by ID
├── scan/[id]/outcome/route.ts       # POST — record outcome; atomic Firestore batch
├── referrals/route.ts               # POST — issue referral code (rate-limited)
├── referrals/[code]/route.ts        # GET — fetch referral details
├── referrals/[code]/redeem/route.ts # POST — partner-confirmed redemption
├── partners/apply/route.ts          # POST — submit business application
├── partners/me/route.ts             # GET — own partner record
├── partners/stats/route.ts          # GET — redemption stats for dashboard
├── auth/callback/route.ts           # POST — verify Firebase token; upsert user doc
├── user/me/route.ts                 # GET — authenticated profile + totals
├── user/scans/route.ts              # GET — scan history (up to 100)
├── user/scans/[scanId]/route.ts     # GET / DELETE — single scan; delete reverses totals
├── leaderboard/route.ts             # GET — top 10 by CO₂ saved (60s cache)
└── health/route.ts                  # GET — liveness probe
```

---

## Environment variables

```bash
# Firebase client SDK (browser-safe)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin — base64-encoded service account JSON (server-only)
FIREBASE_SERVICE_ACCOUNT_BASE64=

# Google Cloud — base64-encoded service account JSON
GOOGLE_APPLICATION_CREDENTIALS_BASE64=
GOOGLE_CLOUD_PROJECT=

# Gemini (required — ingest, cost, landfill, seed script)
GEMINI_API_KEY=

# Google Maps & Places (required for route finding)
GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_KEY=

# WikiRate FTI (optional — used only by seed script, not at scan time)
WIKIRATE_API_KEY=

# Document AI (optional — stub, not implemented)
DOCAI_PROCESSOR_ID=

# BigQuery (optional — brand sustainability grounding)
BIGQUERY_DATASET=
BIGQUERY_BRAND_COLUMN=brand
```

Copy `.env.example` and fill in values. Set the same variables in your Vercel project under **Settings → Environment Variables**.

---

## Getting started

```bash
bun install
bun dev
```

Opens on `http://localhost:3000`.

To base64-encode service accounts for local use:

```bash
FIREBASE_SERVICE_ACCOUNT_BASE64=$(base64 -i firebase-service-account.json)
GOOGLE_APPLICATION_CREDENTIALS_BASE64=$(base64 -i service-account.json)
```

To run tests:

```bash
bun test
```

To seed brand data (run locally, one-time, idempotent):

```bash
bun run scripts/seed-brands.ts
```

Requires `FIREBASE_SERVICE_ACCOUNT_BASE64` and `GEMINI_API_KEY`. `WIKIRATE_API_KEY` is optional — FTI lookup is skipped if absent. The script upserts ~50 brands by slug so it is safe to re-run.

To deploy Firestore security rules:

```bash
firebase deploy --only firestore:rules
```

Before first deploy, reconcile the `users/*` rules in `firestore.rules` against the rules currently active in the Firebase console. All mutations go through the Admin SDK (API routes); the client SDK is initialised for Auth and Storage only.

---

## Design notes

- **Single-call ingest** — one Gemini multimodal call replaces the old Vision OCR → Gemini parse chain. Cheaper, fewer round-trips, and handles garment photo analysis in the same call.
- **Deterministic scoring** — the pitch line is "Gemini parses, the rating is auditable math." `lib/score/garment.ts` and `lib/score/brand.ts` are pure functions with no I/O; the entire score is reproducible from the logged inputs.
- **Circularity guard** — garment brand sub-scores read only `transparency` and `laborSupplyChain` from the brand record, never `productImpact`. This prevents scan evidence from feeding back into the score of the very scans that generated it.
- **κ-weighted brand priors** — verified brands (κ = 150) need roughly 10× as many scans to shift as unclaimed brands (κ = 15), so the aggregate stays stable under sparse evidence.
- **Fire-and-forget side effects** — `recordScanEvidence` and `upsertRegistryEntry` are awaited only in a `.catch`; they never delay or fail the scan response.
- **Verified partners** — partner pinning happens in `lib/partner-routes.ts` after routes are fetched. Organic Places results are left unchanged below pinned partners.
- **One-time QR codes** — referrals expire in 7 days, are single-use, and require the matching verified partner to confirm. Rate-limiting via `lib/rate-limit.ts` applies to issuance.
- **WikiRate at seed time only** — FTI scores live in brand records and are never fetched live per scan, removing a scan-time latency and availability dependency.
- **Content width** — every page's main content column uses `.content-width` (`width: 80%`, centered). Do not introduce ad-hoc `max-w-*` wrappers on top-level page containers.
- **sessionStorage handoff** — images are compressed client-side (max 800px, JPEG 0.5) before storage to stay under the ~5 MB browser quota. Result page reads `sessionStorage` first; falls back to `GET /api/scan/<id>` for direct URL loads.
- **Atomic Firestore batches** — outcome recording and scan deletion both use `WriteBatch` so user totals never drift from their scan history.
- **Server-side only API calls** — all credentials stay on the server; the client only sees final JSON.

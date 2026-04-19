# Rethread

**Scan a tag. See the true cost. Give the garment another life.**

Rethread is a Next.js 15 app that turns a photo of a clothing care label into a complete environmental footprint, a landfill impact breakdown, brand transparency data, and three concrete next steps — one repair option, one resale option, one donation route — all near you. Signed-in users build a closet of past scans, track environmental impact over time, and earn a rank tier.

---

## What it does

1. **Scan** — upload a photo of a care label (and optionally the garment itself).
2. **Analyze** — Cloud Vision OCRs the label; Gemini parses fibers, origin, brand, and category. A lookup table computes water and CO₂ from verified per-fiber LCA data. If a garment photo is provided, Gemini also detects color and condition.
3. **Assess** — Gemini scores dye pollution risk and writes an environmental summary. A second Gemini call describes what would happen if the garment went to landfill (microplastics, methane, dye runoff, breakdown years).
4. **Lookup** — WikiRate is queried for the brand's Fashion Transparency Index score (0–100), sourced from Fashion Revolution's annual index.
5. **Route** — Google Places finds the nearest repair shop, resale store, and donation center. Routes are reordered based on garment condition (poor/fair → repair first; good/excellent → resale first).
6. **Record** — user chooses an outcome (donate, list, repair, or discard). Authenticated users get the outcome saved to Firestore; their running CO₂ and water totals update atomically.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Package manager | Bun |
| Styling | Tailwind CSS v4 |
| UI | React 19 |
| Charts | Recharts (fiber donut, dye bar) |
| 3D | Three.js (point-cloud globe loading screen) |
| Animation | Framer Motion (`motion` v12) |
| AI | Gemini 2.5 Flash (label parsing, garment analysis, cost reasoning, landfill impact) |
| Vision | Google Cloud Vision (care label OCR) |
| Maps | Google Maps & Places API (route finding) |
| Sustainability data | WikiRate REST API (Fashion Transparency Index) |
| Auth | Firebase Authentication (Google OAuth) |
| Database | Firestore (user profiles, scan history, outcome totals) |
| Storage | Firebase Storage (scan images per user) |
| Hosting | Vercel + GCP service account |

---

## Architecture

```
  ┌─────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
  │   Browser   │──────▶│  Next.js API Route   │──────▶│  Google Cloud        │
  │  (upload)   │◀──────│  POST /api/scan      │◀──────│  Vision + Gemini     │
  └─────────────┘       └──────────┬───────────┘       └──────────────────────┘
                                   │
                         ┌─────────┴──────────┐
                         ▼                    ▼
              ┌──────────────────┐  ┌──────────────────┐
              │  Google Places   │  │    WikiRate API   │
              │  (repair/resale/ │  │  (FTI score per  │
              │   donation)      │  │   brand)         │
              └──────────────────┘  └──────────────────┘

  ┌─────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
  │   Browser   │──────▶│  POST /api/scan/     │──────▶│  Firestore + Storage │
  │  (outcome)  │◀──────│     [id]/outcome     │◀──────│  (auth users only)   │
  └─────────────┘       └──────────────────────┘       └──────────────────────┘
```

All API calls run server-side. The browser never holds a key. Scan results are stored in `/tmp` with an in-memory cache in front (30-min TTL) and also passed through `sessionStorage` so the result page loads instantly without a re-fetch.

### Pipeline (one POST, four parallel stages)

```
 photo(s) ──▶ [1. ingest] ──▶ [2. cost + landfill + FTI + routes run in parallel] ──▶ result
```

#### 1. Ingest — what is this garment?

- **Cloud Vision API** OCRs all care label photos in parallel.
- **Gemini** parses the raw OCR text into structured fields: fibers, country of origin, brand, and category. Falls back to a regex parser if Gemini fails.
- If a garment photo is also uploaded, `analyzeGarmentImage` (Gemini) detects color, category, and **condition** (`poor | fair | good | excellent`) from the image.
- Output: a normalized `Garment` object — `{ fibers, origin, category, brand?, color?, condition? }`.

#### 2. Cost — what did it really take?

- **`computeFiberImpact`** (lookup table, no API) calculates water and CO₂ from per-fiber LCA data sourced from WaterFootprint.org and Textile Exchange. Accounts for garment weight by category.
- **Gemini** receives the `Garment` and the pre-computed water/CO₂ figures, then scores dye pollution risk (1–10) and writes an environmental summary.
- Returns structured JSON (schema-enforced):
  ```ts
  {
    water_liters: number,
    co2_kg: number,
    dye_pollution_score: number,   // 1–10
    confidence: 'high' | 'medium' | 'low',
    reasoning: string,
    dye_type?: string,
    dye_reasoning?: string
  }
  ```

#### 3. Landfill impact — what if it's thrown away?

- **Gemini** receives the `Garment` and returns a fiber-aware breakdown:
  ```ts
  {
    summary: string,
    microplastics: string,
    methane: string,
    dye_runoff: string,
    breakdown_years: string
  }
  ```

#### 4. Fashion Transparency Index

- **WikiRate REST API** is queried with the resolved company name for the current and prior year.
- Uses the direct card endpoint: `Fashion_Revolution+Fashion_Transparency_Index+{Company}+{year}.json`
- A brand alias table (80+ entries) maps OCR'd care label names (e.g. "Zara" → "Inditex", "Converse" → "Nike") to WikiRate company names.
- Results are cached in-memory for 24 hours. Returns `null` for brands not in the WikiRate database — the UI shows "No Fashion Transparency Index available for this brand."

#### 5. Routes — where does it go next?

- **Google Places API** fires three `searchText` requests in parallel and finds the nearest result within 5 km per category:
  - `repair` — tailors, cobblers, alterations
  - `resale` — consignment shops, thrift buyers
  - `donation` — shelters, textile recyclers
- `prioritizeRoutesByCondition` reorders the result: `poor`/`fair` garments get repair shown first; `good`/`excellent` get resale first.
- Falls back to placeholder routes if no coordinates are provided.

---

## Pages & components

```
rethread/
├── app/
│   ├── layout.tsx                   # Root layout — fonts, AuthProvider, Header, Footer
│   ├── page.tsx                     # Landing — hero + "how it works" cards
│   ├── scan/page.tsx                # Upload page
│   ├── scanning/page.tsx            # Scanning animation — fires POST /api/scan
│   ├── result/[id]/page.tsx         # Results page (editable outcome)
│   ├── closet/[scanId]/page.tsx     # Closet detail page (read-only results)
│   ├── login/page.tsx               # Google sign-in via Firebase
│   └── profile/page.tsx            # Profile — avatar, rank badge, stats, closet grid
│
├── components/
│   ├── camera-scan.tsx              # Upload UI: garment + tag photos, compression, sessionStorage handoff
│   ├── scanning-view.tsx            # Reads scan:pending; POSTs to /api/scan; routes to result
│   ├── loading-screen.tsx           # Three.js point-cloud globe + blurb cycler (shared loading UI)
│   ├── result-view.tsx              # Full results: garment card, fiber donut, environmental impact,
│   │                                #   dye risk bar, landfill section, FTI badge, routes, outcome picker
│   ├── outcome-section.tsx          # Outcome state machine (idle→confirm→loading→done); uploads images
│   │                                #   to Firebase Storage; POSTs to /api/scan/[id]/outcome
│   ├── header.tsx                   # Logo + HeaderNav
│   ├── header-nav.tsx               # Auth-aware nav (sign-in icon or avatar + sign-out)
│   ├── footer.tsx                   # Footer (hidden on /scan and /scanning)
│   ├── scroll-to-button.tsx         # Smooth-scroll CTA for landing page
│   └── scan-form.tsx                # Legacy single-file upload form (kept for compatibility)
│
├── app/api/
│   ├── scan/route.ts                # POST — full pipeline; rate-limited (5 req/min/IP); magic-byte validation
│   ├── scan/[id]/route.ts           # GET — fetch a stored scan by ID
│   ├── scan/[id]/outcome/route.ts   # POST — record outcome; atomic Firestore batch for auth users
│   ├── auth/callback/route.ts       # POST — verify Firebase token; upsert Firestore user doc
│   ├── user/me/route.ts             # GET — authenticated user profile + totals
│   ├── user/scans/route.ts          # GET — authenticated user's scan history (up to 100)
│   ├── user/scans/[scanId]/route.ts # GET / DELETE — single scan; delete reverses totals + cleans storage
│   ├── leaderboard/route.ts         # GET — top 10 users by CO₂ saved (60s cache)
│   └── health/route.ts              # GET — liveness probe
│
├── lib/
│   ├── config.ts                    # Centralised constants (rate limits, TTLs, file size limits)
│   ├── logger.ts                    # Structured JSON logger with request-scoped trace IDs
│   ├── rate-limit.ts                # In-memory IP rate limiter (5 req/min, auto-eviction at 10k IPs)
│   ├── retry.ts                     # Exponential backoff with jitter; retries on 429/5xx, not 4xx
│   ├── route-utils.ts               # prioritizeRoutesByCondition — pure, non-mutating
│   ├── scan-store.ts                # In-memory + /tmp file cache (30-min TTL, UUID path-traversal guard)
│   ├── fiber-impact.ts              # Per-fiber LCA lookup table (17 fibers, 19 garment weights)
│   ├── wikirate.ts                  # WikiRate FTI lookup — 80+ brand aliases, 24h cache
│   ├── firebase/
│   │   ├── admin.ts                 # Firebase Admin SDK — lazy singleton (auth, Firestore, Storage)
│   │   ├── client.ts                # Firebase client SDK — lazy singleton (auth, Storage)
│   │   ├── auth-context.tsx         # AuthProvider + useAuth — syncs Firebase auth with Firestore totals
│   │   ├── verify-token.ts          # verifyBearerToken — extracts and verifies Firebase ID token
│   │   └── upload-scan-images.ts    # uploadScanImages — data URLs → Firebase Storage blobs
│   └── google/
│       ├── client.ts                # Shared GCP auth (service account; 3 credential source formats)
│       ├── vision.ts                # Cloud Vision OCR + regex-based label parser (fallback)
│       ├── gemini.ts                # Label parsing, garment analysis, cost estimation, landfill impact
│       ├── places.ts                # Route finding via Google Places searchText
│       ├── bigquery.ts              # Optional brand sustainability context (1h cache)
│       └── docai.ts                 # Document AI stub (not implemented)
│
├── types/garment.ts                 # Shared TypeScript types (Garment, ScanResult, LandfillImpact, FTI, …)
├── __tests__/                       # Bun test suite (rate-limit, retry, route-utils, scan-store, API routes)
└── public/                          # UI assets (frame, tape, receipt, burlap, lace, ribbon, hanger, etc.)
                                     # + /models/globe.glb (Three.js point-cloud globe)
```

---

## Image upload flow

1. User picks a garment photo + one or more tag photos on `/scan`. The scan button enables once at least one tag photo is added.
2. Each image is compressed client-side (canvas, max 800px, JPEG 0.5) and stored as a base64 data URL in `sessionStorage` under `scan:pending`.
3. Browser navigates to `/scanning`; `ScanningView` reads `scan:pending`, converts data URLs back to `File` objects, fetches geolocation, and POSTs them as `multipart/form-data` to `/api/scan`.
4. On success, the parsed result is written to `sessionStorage` as `scan:<id>` and the browser redirects to `/result/<id>`.
5. The result page reads from `sessionStorage` first; falls back to `GET /api/scan/<id>` for direct URL loads.
6. When the user records an outcome, `OutcomeSection` uploads the compressed images from `sessionStorage` to Firebase Storage at `scans/{uid}/{scanId}/{index}.jpg`, then POSTs the outcome to `/api/scan/:id/outcome`.

---

## User accounts & closet

Signing in with Google (Firebase OAuth) unlocks:

- **Closet** — every recorded outcome is saved as `/users/{uid}/scans/{scanId}` in Firestore, with scan results and image URLs. Visible on the profile page as a grid of garment tiles.
- **Stats** — running totals for CO₂ saved (kg), water saved (L), garments scanned, and items rerouted update atomically via Firestore batched writes.
- **Rank badges** — five tiers based on scan count: Thread Rookie → Label Reader → Fiber Scout → Eco Advocate → Rethread Pro.
- **Delete** — removing a closet item reverses the associated CO₂/water totals and deletes the images from Firebase Storage.

All Firestore writes on the outcome endpoint are atomic (batched). If Firestore fails, the outcome is still recorded in the local scan store — the user just does not receive environmental credit.

---

## Environment variables

```bash
# Firebase client SDK (required for auth + storage in the browser)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin SDK — base64-encoded service account JSON (required for server-side auth + Firestore)
FIREBASE_SERVICE_ACCOUNT_BASE64=

# Google Cloud — base64-encoded service account JSON (required for Vision, Gemini, Places)
GOOGLE_APPLICATION_CREDENTIALS_BASE64=
GOOGLE_CLOUD_PROJECT=

# Gemini AI (required)
GEMINI_API_KEY=

# Google Maps & Places (required for route finding)
GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_KEY=

# WikiRate Fashion Transparency Index (optional — free key at wikirate.org)
WIKIRATE_API_KEY=

# Document AI — optional, stub not implemented
DOCAI_PROCESSOR_ID=

# BigQuery — optional, for brand sustainability grounding
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

To encode a service account for local use:

```bash
GOOGLE_APPLICATION_CREDENTIALS_BASE64=$(base64 -i service-account.json)
FIREBASE_SERVICE_ACCOUNT_BASE64=$(base64 -i firebase-service-account.json)
```

To run tests:

```bash
bun test
```

---

## Design notes

- **Content width standard** — every page's main content column uses the `.content-width` utility defined in `app/globals.css` (`width: 80%`, centered). Do not introduce ad-hoc `max-w-*` wrappers on top-level page containers.
- **Parallel pipeline** — cost estimation, landfill impact, WikiRate FTI, and route finding all fire at the same time after ingest. No stage blocks another.
- **Lookup table, not AI, for water/CO₂** — `fiber-impact.ts` uses verified LCA data from WaterFootprint.org and Textile Exchange. Gemini only handles dye scoring and reasoning, which has no clean tabular source.
- **Direct WikiRate card endpoint** — the generic `answers.json` endpoint ignores `company_name` filters and returns arbitrary results. The direct `+{Company}+{year}.json` card endpoint is reliable.
- **sessionStorage handoff** — avoids round-tripping large images through the server on navigation. Images are compressed before storage to stay under the ~5 MB browser quota.
- **Structured AI output** — all Gemini calls use `responseSchema` enforcement; unstructured responses are treated as errors.
- **Server-side only API calls** — all credentials stay on the server; the client only sees final JSON.
- **Vercel-compatible storage** — `scan-store.ts` writes to `os.tmpdir()` (the only writable path on Vercel's serverless runtime) with an in-memory Map in front.
- **Rate limiting** — 5 requests per minute per IP, tracked in an in-memory Map that auto-evicts expired entries and bulk-evicts at 10,000 IP capacity.
- **Atomic Firestore batches** — outcome recording and scan deletion both use `WriteBatch` so user totals never drift from their scan history.
- **Condition-based route prioritization** — `route-utils.ts` reorders the repair/resale/donation tuple based on the garment condition detected from the optional garment photo. No condition → routes returned in default order.

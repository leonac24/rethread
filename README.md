# Rethread

**Scan a tag. See the true cost. Give the garment another life.**

Rethread is a Next.js 15 app that turns a photo of a clothing care label into a complete environmental footprint, a landfill impact breakdown, brand transparency data, and three concrete next steps — one repair option, one resale option, one donation route — all near you. Signed-in users build a closet of past scans, track environmental impact over time, and earn a rank tier.

---

## What it does

1. **Scan** — upload a photo of a care label (and optionally the garment itself).
2. **Analyze** — Cloud Vision OCRs the label; then one multimodal Gemini "super call" sees every photo (plus the OCR text) and returns the whole analysis at once: fibers, origin, brand, category, color, condition, dye pollution scoring, disposal impact, landfill breakdown (microplastics, methane, dye runoff, breakdown years), and an ultraconservative resale payout. A lookup table computes water and CO₂ from verified per-fiber LCA data.
3. **Assess** — the same call's dye/disposal/landfill sections become the environmental summary; nothing is estimated twice, so the breakdown always describes one internally consistent garment.
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
| AI | Gemini 2.5 Flash (one multimodal super call: identification, dye/disposal reasoning, landfill impact, resale appraisal) |
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

### Pipeline (one POST, one super call)

```
 photo(s) ──▶ [1. OCR] ──▶ [2. Gemini super call] ──▶ [3. lookup water/CO₂ · FTI ∥ routes] ──▶ result
```

#### 1. OCR

- **Cloud Vision API** OCRs all care label photos in parallel. The raw text rides along as an auxiliary signal (and powers the regex fallback if Gemini is unavailable).

#### 2. One Gemini super call — `analyzeGarment`

- A single multimodal, schema-enforced request receives **every photo** (labels + garment) plus the OCR text and returns the entire analysis at once:
  - **Identification** — fibers, country of origin, brand (luxury houses included), category, color, condition (`poor | fair | good | excellent`). When no fiber label is readable, Gemini estimates the likely mixed composition from the photos (e.g. sneakers → polyester mesh / rubber / EVA foam) and flags it `fibers_estimated` — the UI marks these as an AI guess everywhere fibers appear.
  - **Dye analysis** — pollution score (1–10), likely dye family, reasoning.
  - **Disposal** — CO₂, landfill years, one-line note.
  - **Landfill impact** — `{ summary, microplastics, methane, dye_runoff, breakdown_years }`.
  - **Resale payout** — ultraconservative `{ low_usd, high_usd, confidence, factors }`.
- One call means one internally consistent garment: the identity, the eco breakdown, and the price can never disagree. It also cuts four sequential Gemini round-trips to one.
- The same function powers the closet "Sell It" re-appraisal (`POST /api/user/scans/[scanId]/evaluate`), which re-runs it on the stored photos and persists the whole refreshed result.

#### 3. Water/CO₂ — lookup table, never AI

- **`computeFiberImpact`** (no API) calculates water and CO₂ from per-fiber LCA data sourced from WaterFootprint.org and Textile Exchange, using the fibers/category the super call identified. Accounts for garment weight by category.

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
│   ├── listings/route.ts            # POST — list a closet item for sale (auth owner)
│   ├── listings/[id]/route.ts       # GET owner detail w/ offers · PATCH cancel
│   ├── listings/[id]/offers/…       # POST offer (retailer) · PATCH withdraw · POST accept / decline (owner)
│   ├── listings/[id]/label/route.ts # POST — accepted retailer buys a Shippo label
│   ├── listings/[id]/received/route.ts # POST — retailer completes the deal (kickback ledger)
│   ├── retailer/listings/route.ts   # GET — active listings feed, nearest-first (approved retailers)
│   ├── retailer/deals/route.ts      # GET — retailer's accepted/completed deals
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
│       ├── gemini.ts                # analyzeGarment — the one multimodal super call (identify + dye + landfill + resale)
│       ├── places.ts                # Route finding via Google Places searchText
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

## Resale marketplace

Rethread partners with local resale stores (pilot: Uptown Cheapskate). Users list closet items; approved retailers make offers; Rethread's kickback is settled offline using completed-deal records as the ledger. No money moves through the app.

**Roles.** The login page has a "Sign up as a retailer" toggle that collects store details (name, structured address, phone). Applications land as `retailer.status: 'pending'` on the user doc and are approved by hand (flip to `'approved'` in the Firebase console). All retailer routes check `role === 'retailer' && retailer.status === 'approved'`.

**Estimate.** The scan-time super call appraises the actual photos (brand labels included), so an ultraconservative resale-payout range (what a thrift store *pays out* — ~20–30% of resale for mass-market, 30–40% for recognized designer pieces, rounded down) is stored with every scan up front. The closet "Sell It" pin therefore shows the price **instantly** and lists in one tap (a small ✕ on the pin unlists); older scans without a stored appraisal re-run the same super call on demand via `POST /api/user/scans/[scanId]/evaluate`, which also refreshes the whole eco breakdown so details and price never disagree. The retailer feed shows each listing's appraised range and its reasoning factors so stores can offer quickly and in the right bracket (owner identity and address stay hidden).

**Listings.** `listings/{id}` is a top-level collection with a denormalized garment snapshot, so retailers never read user subcollections. Location is rounded to ~1 km. Mirror fields (`listingId`, `listingStatus`, `listingOfferCount`) on the owner's scan doc drive the closet tile tags (For Sale → Offer → Sale Pending → Sold). Deleting a scan cancels any in-flight listing atomically; completed listings survive (ledger integrity).

**Offers.** Single take-it-or-leave-it offers, one open offer per retailer per listing; competition comes from multiple stores offering. Accepting one auto-declines the rest in the same batch and records `acceptedAmountUsd`.

**Fulfillment.** Drop-off generates a 6-char pickup code the store matches in person. Shipping: the user provides an address at acceptance; the retailer buys a prepaid label through the platform Shippo account (cheapest rate, parcel defaults by garment category); the user downloads the label PDF from their closet. The retailer marks the item received, which sets `finalAmountUsd` + `completedAt` — the kickback ledger row.

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

# Shippo — prepaid shipping labels for marketplace deals (test-mode token in dev)
SHIPPO_API_KEY=

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

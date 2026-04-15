# Rethread

**Scan a tag. See the true cost. Give the garment another life.**

Rethread is a Next.js 15 app that turns a photo of a clothing care label into a complete environmental footprint, a landfill impact breakdown, brand transparency data, and three concrete next steps — one repair option, one resale option, one donation route — all near you.

---

## What it does

1. **Scan** — upload a photo of a care label (and optionally the garment itself).
2. **Analyze** — Cloud Vision OCRs the label; Gemini parses fibers, origin, brand, and category. A lookup table computes water and CO₂ from verified per-fiber LCA data.
3. **Assess** — Gemini scores dye pollution risk and writes an environmental summary. A second Gemini call describes what would happen if the garment went to landfill (microplastics, methane, dye runoff, breakdown years).
4. **Lookup** — WikiRate is queried for the brand's Fashion Transparency Index score (0–100), sourced from Fashion Revolution's annual index.
5. **Route** — Google Places finds the nearest repair shop, resale store, and donation center.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Package manager | Bun |
| Styling | Tailwind CSS v4 |
| UI | React 19 |
| Charts | Recharts (fiber donut, dye bar) |
| 3D | Three.js (point-cloud globe on scanning screen) |
| AI | Gemini 2.5 Flash (label parsing, cost reasoning, landfill impact) |
| Vision | Google Cloud Vision (care label OCR) |
| Maps | Google Maps & Places API (route finding) |
| Sustainability data | WikiRate REST API (Fashion Transparency Index) |
| Hosting | Vercel + GCP service account |

---

## Architecture

```
  ┌─────────────┐       ┌──────────────────────┐       ┌──────────────────────┐
  │   Browser   │──────▶│  Next.js API Route   │──────▶│  Google Cloud        │
  │  (upload)   │◀──────│  POST /api/scan      │◀──────│  Vision + Gemini     │
  └─────────────┘       └──────────┬───────────┘       └──────────────────────┘
                                   │
                         ┌─────────┴─────────┐
                         ▼                   ▼
              ┌──────────────────┐  ┌──────────────────┐
              │  Google Places   │  │    WikiRate API   │
              │  (repair/resale/ │  │  (FTI score per  │
              │   donation)      │  │   brand)         │
              └──────────────────┘  └──────────────────┘
```

All API calls run server-side. The browser never holds a key. Scan results are stored in `/tmp` with an in-memory cache in front (30-min TTL) and also passed through `sessionStorage` so the result page loads instantly without a re-fetch.

### Pipeline (one POST, four parallel stages)

```
 photo(s) ──▶ [1. ingest] ──▶ [2. cost + landfill + FTI + routes run in parallel] ──▶ result
```

#### 1. Ingest — what is this garment?

- **Cloud Vision API** OCRs the care label photo(s).
- **Gemini** parses the raw OCR text into structured fields: fibers, country of origin, brand, and category. Falls back to a regex parser if Gemini fails.
- If a garment photo is also uploaded, `analyzeGarmentImage` (Gemini) detects color and category from the image.
- Output: a normalized `Garment` object — `{ fibers, origin, category, brand?, color? }`.

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
- A brand alias table maps OCR'd care label names (e.g. "Zara" → "Inditex", "Converse" → "Nike") to WikiRate company names.
- Results are cached in-memory for 24 hours. Returns `null` for brands not in the WikiRate database — the UI shows "No Fashion Transparency Index available for this brand."

#### 5. Routes — where does it go next?

- **Google Places API** finds one result per category near the user's coordinates:
  - `repair` — tailors, cobblers, alterations
  - `resale` — consignment shops, thrift buyers
  - `donation` — shelters, textile recyclers
- Falls back to placeholder routes if no coordinates are provided.

---

## Pages & components

```
rethread/
├── app/
│   ├── layout.tsx              # Global header (logo + Profile link)
│   ├── page.tsx                # Landing — hero + "how it works"
│   ├── scan/page.tsx           # Upload page
│   ├── scanning/page.tsx       # Scanning animation (Three.js globe + blurb cycler)
│   ├── result/[id]/page.tsx    # Results page
│   └── profile/page.tsx        # Profile — closet, stats, tier
│
├── components/
│   ├── camera-scan.tsx         # Upload UI: garment + tag photos, compression, sessionStorage handoff
│   ├── scanning-view.tsx       # Three.js globe; fires POST /api/scan; routes to result
│   └── result-view.tsx         # Full results UI: garment card, fiber donut, environmental impact,
│                               #   dye risk bar, landfill section, FTI badge, routes, OCR receipt
│
├── app/api/
│   ├── scan/route.ts           # POST — full pipeline; rate-limited (5 req/min/IP); magic-byte validation
│   └── scan/[id]/route.ts      # GET — fetch a stored scan by ID
│
├── lib/
│   ├── config.ts               # Centralised constants (rate limits, TTLs, file size limits)
│   ├── logger.ts               # Structured logger with request-scoped trace IDs
│   ├── retry.ts                # Exponential backoff retry wrapper for Gemini calls
│   ├── scan-store.ts           # In-memory + /tmp file cache (30-min TTL, UUID path-traversal guard)
│   ├── fiber-impact.ts         # Per-fiber LCA lookup table (water L/kg, CO₂ kg/kg) + garment weights
│   ├── wikirate.ts             # WikiRate FTI lookup — brand alias table, 24h cache, direct card endpoint
│   └── google/
│       ├── client.ts           # Shared GCP auth (service account via base64 env var)
│       ├── vision.ts           # Cloud Vision OCR
│       ├── gemini.ts           # Label parsing, garment analysis, cost estimation, landfill impact
│       └── places.ts           # Route finding via Google Places
│
├── types/garment.ts            # Shared TypeScript types (Garment, ScanResult, LandfillImpact, FTI, …)
└── public/images/              # UI assets (frame, tape, receipt, burlap, lace, ribbon, hanger, etc.)
```

---

## Image upload flow

1. User picks a garment photo + one or more tag photos on `/scan`. Both are required before the scan button is enabled.
2. Each image is compressed client-side (canvas, max 800px, JPEG 0.5) and stored as a base64 data URL in `sessionStorage` under `scan:pending`.
3. Browser navigates to `/scanning`; `ScanningView` reads `scan:pending`, converts data URLs back to `File` objects, and POSTs them as `multipart/form-data` to `/api/scan`.
4. On success, the parsed result is written to `sessionStorage` as `scan:<id>` and the browser redirects to `/result/<id>`.
5. The result page reads from `sessionStorage` first; falls back to `GET /api/scan/<id>` for direct URL loads.

---

## Environment variables

```bash
# Google Cloud — base64-encoded service account JSON (required)
GOOGLE_APPLICATION_CREDENTIALS_BASE64=
GOOGLE_CLOUD_PROJECT=

# Gemini AI (required)
GEMINI_API_KEY=

# Google Maps & Places (required for route finding)
GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_KEY=

# WikiRate Fashion Transparency Index (optional — free key at wikirate.org)
WIKIRATE_API_KEY=

# Document AI — optional, for receipt parsing
DOCAI_PROCESSOR_ID=

# BigQuery — optional, for brand sustainability grounding
BIGQUERY_DATASET=
BIGQUERY_BRAND_COLUMN=brand
```

Set these in your Vercel project dashboard under **Settings → Environment Variables**.

---

## Getting started

```bash
bun install
bun dev
```

Opens on `http://localhost:3000`.

To encode your service account for local use:

```bash
GOOGLE_APPLICATION_CREDENTIALS_BASE64=$(base64 -i service-account.json)
```

---

## Design notes

- **Parallel pipeline** — cost estimation, landfill impact, WikiRate FTI, and route finding all fire at the same time after ingest. No stage blocks another.
- **Lookup table, not AI, for water/CO₂** — `fiber-impact.ts` uses verified LCA data from WaterFootprint.org and Textile Exchange. Gemini only handles dye scoring and reasoning, which has no clean tabular source.
- **Direct WikiRate card endpoint** — the generic `answers.json` endpoint ignores `company_name` filters and returns arbitrary results. The direct `+{Company}+{year}.json` card endpoint is reliable.
- **sessionStorage handoff** — avoids round-tripping large images through the server on navigation. Images are compressed before storage to stay under the ~5 MB browser quota.
- **Structured AI output** — all Gemini calls use `responseSchema` enforcement; unstructured responses are treated as errors.
- **Server-side only API calls** — all credentials stay on the server; the client only sees final JSON.
- **Vercel-compatible storage** — `scan-store.ts` writes to `os.tmpdir()` (the only writable path on Vercel's serverless runtime) with an in-memory Map in front.
- **Rate limiting** — 5 requests per minute per IP, tracked in an in-memory Map that auto-evicts expired entries to prevent unbounded growth.

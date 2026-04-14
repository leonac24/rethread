# Rethread

**Scan a tag. See the true cost. Give the garment another life.**

Rethread is a Next.js 15 app that turns a photo of a clothing care label into a complete environmental footprint and three concrete next steps — one repair option, one resale option, one donation route — all near you.

---

## What it does

1. **Scan** — upload a photo of a care label (and optionally the garment itself).
2. **Analyze** — Cloud Vision OCRs the label; Gemini estimates the garment's water, CO₂, and dye footprint.
3. **Route** — Google Places finds the nearest repair shop, resale store, and donation center.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Package manager | Bun |
| Styling | Tailwind CSS v4 + CSS Modules |
| UI | React 19 |
| 3D | Three.js (point-cloud globe on scanning screen) |
| Charts | Recharts (fiber donut chart) |
| AI / APIs | Google Cloud Vision, Gemini, Google Maps & Places |
| Hosting | Vercel + GCP service account |

---

## Architecture

```
  ┌─────────────┐       ┌──────────────────────┐       ┌─────────────────┐
  │   Browser   │──────▶│  Next.js API Route   │──────▶│  Google Cloud   │
  │  (upload)   │◀──────│  /api/scan (POST)    │◀──────│  Vision + Gemini│
  └─────────────┘       └──────────┬───────────┘       └─────────────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │   Google Places API  │
                        │  (repair/resale/     │
                        │   donation routes)   │
                        └──────────────────────┘
```

All Google API calls run server-side. The browser never holds a key. Scan results are cached in `/tmp` for 30 minutes and also passed through `sessionStorage` so the result page loads instantly without a refetch.

### Pipeline (one POST, three stages)

```
 photo(s) ──▶ [1. ingest] ──▶ [2. cost] ──▶ [3. route] ──▶ result
```

#### 1. Ingest — what is this garment?

- **Cloud Vision API** OCRs the care label and extracts raw text.
- `parseClothingLabelText` (Gemini) parses fibers, country of origin, brand, and category from the OCR text.
- If a garment photo is also uploaded, `analyzeGarmentImage` (Gemini) detects the garment's color and category.
- Output: a normalized `Garment` object — `{ fibers, origin, category, brand?, color? }`.

#### 2. Cost — what did it really take?

- **Gemini** receives the `Garment` object plus industry benchmark context.
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

#### 3. Route — where does it go next?

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
│   ├── page.tsx                # Landing — hero + "how it works" alternating rows
│   ├── scan/page.tsx           # Upload page (CameraScan component)
│   ├── scanning/page.tsx       # Scanning animation (Three.js globe + blurb cycler)
│   ├── result/[id]/page.tsx    # Results dashboard
│   └── profile/page.tsx        # User profile — closet, stats, tier
│
├── components/
│   ├── camera-scan.tsx         # Upload UI: garment + tag photos, compression, sessionStorage handoff
│   ├── scanning-view.tsx       # Three.js point-cloud globe; fires POST /api/scan; routes to result
│   └── result-view.tsx         # Full results UI: fiber donut, env impact, dye risk, map, OCR, routes
│
├── app/api/
│   ├── scan/route.ts           # POST — full Vision + Gemini + Places pipeline; rate-limited (5 req/min/IP)
│   └── scan/[id]/route.ts      # GET — fetch a stored scan by ID
│
├── lib/
│   ├── scan-store.ts           # In-memory + /tmp file cache (30-min TTL)
│   └── google/
│       ├── client.ts           # Shared GCP auth (service account via env var)
│       ├── vision.ts           # Cloud Vision OCR
│       ├── gemini.ts           # Label parsing, garment analysis, cost estimation
│       └── places.ts           # Route finding via Google Places
│
├── types/garment.ts            # Shared TypeScript types
└── public/images/              # UI assets (paper, frame, tape, receipt, burlap, lace, hanger, etc.)
```

---

## Image upload flow

1. User picks a garment photo + one or more tag photos on `/scan`.
2. Each image is compressed client-side (canvas, max 800px, JPEG 0.5 quality) and stored as a base64 data URL in `sessionStorage` under `scan:pending`.
3. Browser navigates to `/scanning`; the `ScanningView` component reads `scan:pending`, converts data URLs back to `File` objects, and POSTs them as `multipart/form-data` to `/api/scan`.
4. On success, the parsed result is written to `sessionStorage` as `scan:<id>` and the browser is redirected to `/result/<id>`.
5. The result page reads from `sessionStorage` first; falls back to `GET /api/scan/<id>` for direct URL loads.

---

## Environment variables

```bash
GOOGLE_APPLICATION_CREDENTIALS_BASE64=   # base64-encoded service account JSON
GOOGLE_CLOUD_PROJECT=                    # GCP project ID
GEMINI_API_KEY=                          # Gemini API key
GOOGLE_MAPS_API_KEY=                     # Maps & Places API key
DOCAI_PROCESSOR_ID=                      # Document AI processor (optional)
```

Set these in your Vercel project dashboard under **Settings → Environment Variables**.

---

## Getting started

```bash
bun install
bun dev
```

Opens on `http://localhost:3000`.

For local Google API calls, place your service account JSON at the project root and set:

```bash
GOOGLE_APPLICATION_CREDENTIALS_BASE64=$(base64 -i service-account.json)
```

---

## Design notes

- **sessionStorage handoff** — avoids round-tripping large images through the server on navigation. Images are compressed before storage to stay under the ~5 MB browser quota.
- **Server-side only API calls** — all Google credentials stay on the server; the client only sees the final JSON result.
- **Structured AI output** — Gemini is always called with a `responseSchema`; unstructured responses are treated as errors.
- **Three options, not thirty** — the route finder returns exactly one repair, one resale, one donation result. The value is the decision, not the list.
- **Vercel-compatible storage** — `scan-store.ts` writes to `/tmp` (the only writable directory on Vercel's serverless runtime) with an in-memory cache layer in front.

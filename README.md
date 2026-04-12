# Rethread

**Scan a tag. See the true cost. Give the garment another life.**

Rethread is a Next.js app that turns a single photo of a clothing label into a complete environmental footprint and a concrete set of next steps: one repair option, one resale option, one donation route — all within walking distance.

---

## What it does

1. **Scan** — user snaps a photo of a care label (or drops in a receipt).
2. **Reason** — Gemini computes the garment's fiber-to-landfill footprint from the extracted data.
3. **Route** — the app returns the three nearest places to repair, resell, or donate it.

Three screens. One photo. One decision.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, Server Actions) |
| Runtime / package manager | Bun |
| Styling | Tailwind CSS v4 |
| UI | React 19 |
| AI / APIs | Google Cloud Vision, Document AI, Gemini, Maps, Places, BigQuery |
| Hosting | Vercel (edge) + GCP (service account for Google APIs) |

---

## Architecture

```
  ┌─────────────┐       ┌──────────────────────┐       ┌─────────────┐
  │   Client    │──────▶│   Next.js Server     │──────▶│  Google AI  │
  │  (camera)   │◀──────│   Actions / Route    │◀──────│  + Maps     │
  └─────────────┘       │     Handlers         │       └─────────────┘
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │  BigQuery (brand     │
                        │  sustainability DB)  │
                        └──────────────────────┘
```

Everything Google-facing runs server-side through a single shared service-account client. The browser never holds a key.

### Pipeline (one request, three stages)

```
 photo ──▶ [1. ingest] ──▶ [2. cost] ──▶ [3. route] ──▶ result
```

#### 1. Ingest — what is this garment?

- **Cloud Vision API** → OCRs the care label. Extracts fiber composition, country of manufacture, care symbols.
- **Document AI** *(optional branch)* → if the user uploads a receipt instead of a tag, extracts brand, item name, price, quantity using a custom parser.
- Output: a normalized `Garment` object: `{ fibers, origin, category, brand?, price? }`.

#### 2. Cost — what did it really take?

- **Gemini 2.5** receives the `Garment` object plus a short system prompt with industry benchmarks (liters/kg for cotton, kg CO₂e for polyester, etc.).
- **BigQuery** is queried in parallel for a brand-level sustainability row (sourced from Good On You + Fashion Transparency Index). If a row exists, it's injected into the Gemini prompt as grounding context.
- Gemini returns **structured JSON** (enforced via `responseSchema`):
  ```ts
  {
    water_liters: number,
    co2_kg: number,
    dye_pollution_score: 1..10,
    confidence: 'high' | 'medium' | 'low',
    reasoning: string
  }
  ```

#### 3. Route — where does it go next?

- **Maps API** (Geocoding + Distance Matrix) → user's location → nearest candidates for three categories:
  - `repair` (tailors, cobblers, menders)
  - `resale` (consignment, thrift buyers)
  - `donation` (shelters, textile recyclers)
- **Places API** → enriches each with hours, rating, photo, and a quick "accepts this item?" heuristic from place-type + Gemini's category.
- Exactly **one** result per category is returned. No endless list.

---

## Data flow

```
 app/scan/page.tsx        ← camera + upload UI
      │
      ▼
 app/actions/scan.ts      ← server action: runs the pipeline
      │
      ├─▶ lib/google/vision.ts        (ingest)
      ├─▶ lib/google/docai.ts         (ingest – receipt branch)
      ├─▶ lib/google/gemini.ts        (cost)
      ├─▶ lib/google/bigquery.ts      (cost – grounding)
      └─▶ lib/google/places.ts        (route)
      │
      ▼
 app/result/[id]/page.tsx ← renders footprint + 3 routes
```

One server action owns the whole pipeline. No client-side API calls. No intermediate endpoints to maintain.

---

## Project structure

```
rethread/
├── app/
│   ├── page.tsx              # Landing
│   ├── scan/page.tsx         # Camera + upload
│   ├── result/[id]/page.tsx  # Footprint + 3 routes
│   └── actions/
│       └── scan.ts           # Server action — full pipeline
├── lib/
│   └── google/
│       ├── client.ts         # Shared auth
│       ├── vision.ts
│       ├── docai.ts
│       ├── gemini.ts
│       ├── bigquery.ts
│       └── places.ts
├── components/               # UI primitives
├── types/garment.ts          # Shared types
└── public/
```

---

## Environment

```bash
GOOGLE_APPLICATION_CREDENTIALS_FILE=   # absolute path to local service-account json
GOOGLE_CLOUD_PROJECT=rethread-tag-ingestion
GOOGLE_APPLICATION_CREDENTIALS_JSON=   # optional inline service account json
GEMINI_API_KEY=
GOOGLE_MAPS_API_KEY=
DOCAI_PROCESSOR_ID=
BIGQUERY_DATASET=rethread-tag-ingestion.brand_ratings
```

---

## Getting started

```bash
bun install
bun dev
```

Opens on `http://localhost:3000`.

---

## Design principles

1. **One photo, one answer.** No sign-in, no wizards, no multi-step forms.
2. **Server does the thinking.** All Google calls run in a single server action — the client only holds a camera and a result.
3. **Structured AI output only.** Gemini must return schema-validated JSON; anything else is an error.
4. **Three options, not thirty.** The value is the decision, not the search.

# Backend PRD — Rethread New Features
**Author:** Backend Engineer  
**Date:** 2026-04-14  
**Branch:** `dev`  
**Status:** Ready for implementation

---

## Overview

This PRD covers the backend work required to ship four product features:

1. Condition-based route recommendations
2. Environmental impact disclosure for disposal
3. Post-scan action logging (outcome endpoint)
4. Account system with environmental impact tracking + leaderboard

Features are ordered by dependency, not by product priority. The account system (Feature 3) depends on the outcome endpoint (Feature 4), so Feature 4 is implemented first in Phase 2.

---

## Pre-condition: Fix 7 Open MAJOR Issues

**These must be resolved before any feature work begins.** Every new feature builds on the existing scan pipeline. Shipping features on top of known bugs compounds the blast radius.

### Step 0.1 — Wrap `analyzeGarmentImage` in `withRetry`
**File:** `lib/google/gemini.ts:204`

`computeCost` already uses `withRetry`. `analyzeGarmentImage` is a bare `fetch` with no retry. A transient 503 from the Gemini API will silently drop the condition assessment for the garment photo.

**Change:** Wrap the `fetch` call inside `withRetry(async () => { ... }, { retries: 3, label: 'Gemini-image' })`. The existing `HttpError` class and `RETRYABLE_STATUSES` set apply without modification.

---

### Step 0.2 — Return 400 on garment photo magic-byte failure
**File:** `app/api/scan/route.ts:162`

Currently, if the garment photo fails the magic-byte check, the code silently sets `garmentPhotoBuffer = null` and continues. The user uploaded a non-image and received no feedback.

**Change:** Replace the silent skip with an explicit 400 response:
```ts
if (!isImageMagicBytes(buf)) {
  return Response.json(
    { error: 'The garment photo is not a valid image.' },
    { status: 400, headers: { 'X-Trace-Id': traceId } },
  );
}
```

---

### Step 0.3 — Fix `nearest()` killing sibling route results
**File:** `lib/google/places.ts`

`findRoutes` calls `Promise.all([nearest('repair'), nearest('resale'), nearest('donation')])`. If `nearest()` throws (e.g. Places API returns zero results for one category), `Promise.all` rejects immediately and all three routes fail — the caller receives `fallbackRoutes()` even when two of three lookups succeeded.

**Change:** Replace `Promise.all` with `Promise.allSettled`. For any rejected slot, insert the corresponding per-kind fallback:
```ts
const [repair, resale, donation] = await Promise.allSettled([
  nearest(lat, lng, 'repair', category),
  nearest(lat, lng, 'resale', category),
  nearest(lat, lng, 'donation', category),
]);

return [
  repair.status === 'fulfilled' ? repair.value : fallbackRoute('repair'),
  resale.status === 'fulfilled' ? resale.value : fallbackRoute('resale'),
  donation.status === 'fulfilled' ? donation.value : fallbackRoute('donation'),
];
```

---

### Step 0.4 — Move token fetch inside `withRetry` body
**File:** `lib/google/bigquery.ts`

The access token is fetched once before the `withRetry` loop. On a 401 retry, the same expired token is reused, making the retry useless.

**Change:** Move `const token = await getGoogleAccessToken()` to the first line inside the `withRetry` async callback so each attempt fetches a fresh token.

---

### Step 0.5 — Sanitize `fiber.material` before Gemini prompt
**File:** `lib/google/gemini.ts:41`

`buildPrompt` sanitizes `origin`, `category`, `brand`, and `color` via `sanitizeForPrompt`. The `fibers` array is serialized directly via `JSON.stringify(safeGarment)` without sanitizing `fiber.material`. A crafted label could inject content into the Gemini prompt.

**Change:** Map over fibers before including them:
```ts
fibers: garment.fibers.map((f) => ({
  material: sanitizeForPrompt(f.material),
  percentage: f.percentage,
})),
```

---

### Step 0.6 — Add try/catch around `JSON.parse` in `parseCredentials`
**File:** `lib/google/client.ts:15`

If the `GOOGLE_SERVICE_ACCOUNT_JSON` env var contains malformed JSON, `JSON.parse` throws an unhandled exception that propagates as an opaque 500 with no diagnostic context.

**Change:**
```ts
function parseCredentials(raw: string): ServiceAccountCredentials {
  try {
    return JSON.parse(raw) as ServiceAccountCredentials;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. Check the environment variable.');
  }
}
```

---

### Step 0.7 — Validate shape of parsed disk JSON in `getScanById`
**File:** `lib/scan-store.ts:100`

`JSON.parse(raw) as StoredScan` is a TypeScript lie — the `as` cast does nothing at runtime. A corrupt or truncated file returns a partial object that downstream code treats as a valid `StoredScan`.

**Change:** Add a shape guard after parsing:
```ts
const parsed = JSON.parse(raw);
if (
  !parsed ||
  typeof parsed !== 'object' ||
  typeof parsed.id !== 'string' ||
  typeof parsed.createdAt !== 'number' ||
  !parsed.result
) {
  log.warn('Corrupt scan file on disk, discarding', { id });
  unlink(filePath).catch(() => {});
  return null;
}
```

---

## Phase 1 — Condition Assessment + Disposal Impact

**No new dependencies. Extends existing Gemini calls. Can ship in a single PR.**

### Step 1.1 — Add `GarmentCondition` type
**File:** `types/garment.ts`

Add the union type and extend `Garment`:
```ts
export type GarmentCondition = 'poor' | 'fair' | 'good' | 'excellent';

export type Garment = {
  fibers: Fiber[];
  origin: string | null;
  category: string | null;
  brand?: string;
  color?: string;
  condition?: GarmentCondition;  // new
};
```

---

### Step 1.2 — Extend `analyzeGarmentImage` to return condition
**File:** `lib/google/gemini.ts`

Extend the return type:
```ts
export type GarmentImageAnalysis = {
  category: string | null;
  color: string | null;
  condition: GarmentCondition | null;  // new
};
```

Add `condition` to the Gemini prompt instruction:
```
Also assess the visible wear of the garment: 'poor' (significant damage/stains),
'fair' (minor wear), 'good' (light use), or 'excellent' (like new).
```

Add `condition` to `responseSchema`:
```ts
condition: { type: 'STRING', enum: ['poor', 'fair', 'good', 'excellent'] },
```

In the response normalization, validate against the union before accepting:
```ts
const VALID_CONDITIONS = new Set(['poor', 'fair', 'good', 'excellent']);
condition: typeof result.condition === 'string' && VALID_CONDITIONS.has(result.condition)
  ? (result.condition as GarmentCondition)
  : null,
```

**Security note:** `condition` is Gemini-generated output — not user input — but always validate against the enum. Never trust LLM output shapes.

---

### Step 1.3 — Wire condition into scan pipeline
**File:** `app/api/scan/route.ts`

Pass `imageAnalysis.condition` when building the `garment` object:
```ts
const garment: ScanResult['garment'] = {
  fibers: parsed.fibers ?? [],
  origin: parsed.origin ?? null,
  category: parsed.category ?? imageAnalysis?.category ?? null,
  ...(parsed.brand ? { brand: parsed.brand } : {}),
  ...(imageAnalysis?.color ? { color: imageAnalysis.color } : {}),
  ...(imageAnalysis?.condition ? { condition: imageAnalysis.condition } : {}),  // new
};
```

---

### Step 1.4 — Add `prioritizeRoutesByCondition` to route pipeline
**File:** `app/api/scan/route.ts`

Add a pure function (no side effects, easy to unit test):
```ts
function prioritizeRoutesByCondition(
  routes: [RouteOption, RouteOption, RouteOption],
  condition: GarmentCondition | null | undefined,
): [RouteOption, RouteOption, RouteOption] {
  if (!condition) return routes;
  const sorted = [...routes];
  const targetKind = condition === 'poor' || condition === 'fair' ? 'repair' : 'resale';
  const idx = sorted.findIndex((r) => r.kind === targetKind);
  if (idx > 0) {
    const [target] = sorted.splice(idx, 1);
    sorted.unshift(target);
  }
  return sorted as [RouteOption, RouteOption, RouteOption];
}
```

Call it after `await Promise.all([costPromise, routesPromise])`:
```ts
const prioritizedRoutes = prioritizeRoutesByCondition(routes, garment.condition);
const result: ScanResult = { id, garment, cost, routes: prioritizedRoutes };
```

---

### Step 1.5 — Add disposal impact fields to `EnvironmentalCost`
**File:** `types/garment.ts`

```ts
export type EnvironmentalCost = {
  water_liters: number;
  co2_kg: number;
  dye_pollution_score: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  dye_type?: string;
  dye_reasoning?: string;
  disposal_co2_kg: number;         // new — CO2 if sent to landfill/incineration
  disposal_landfill_years: number; // new — estimated decomposition time in years
  disposal_note: string;           // new — human-readable summary under 40 words
};
```

---

### Step 1.6 — Extend `computeCost` prompt and schema for disposal
**File:** `lib/google/gemini.ts`

Add to `buildPrompt`:
```
Also estimate the environmental impact if this garment is discarded:
- disposal_co2_kg: CO2 released via landfill decomposition or incineration
- disposal_landfill_years: estimated years to decompose in landfill
- disposal_note: one sentence summarising disposal impact (max 40 words)
```

Add to `responseSchema.properties`:
```ts
disposal_co2_kg: { type: 'NUMBER' },
disposal_landfill_years: { type: 'NUMBER' },
disposal_note: { type: 'STRING' },
```

Add to `responseSchema.required`:
```ts
required: [...existing, 'disposal_co2_kg', 'disposal_landfill_years', 'disposal_note'],
```

Extend `normalizeCost` validation:
```ts
if (
  typeof candidate.disposal_co2_kg !== 'number' ||
  typeof candidate.disposal_landfill_years !== 'number' ||
  typeof candidate.disposal_note !== 'string'
) {
  throw new Error('Gemini response missing disposal fields.');
}

return {
  ...existingFields,
  disposal_co2_kg: Math.max(0, Number(candidate.disposal_co2_kg.toFixed(2))),
  disposal_landfill_years: Math.max(0, Math.round(candidate.disposal_landfill_years)),
  disposal_note: sanitizeResponseText(candidate.disposal_note.trim(), 200),
};
```

---

## Phase 2 — Action Logging (Outcome Endpoint)

**New endpoint. No new infrastructure. Outcomes share the 30-min TTL of the scan they belong to.**

### Step 2.1 — Define the outcome action type
**File:** `types/garment.ts`

```ts
export type OutcomeAction = 'throw_away' | 'repair' | 'list' | 'donate';
```

---

### Step 2.2 — Extend `StoredScan` in `scan-store.ts`
**File:** `lib/scan-store.ts`

```ts
type StoredScan = {
  id: string;
  text: string;
  result: ScanResult;
  createdAt: number;
  outcome?: OutcomeAction;  // set once, immutable after first write
  outcomeAt?: number;       // unix ms timestamp of when outcome was recorded
};
```

---

### Step 2.3 — Add `recordOutcome` to scan store
**File:** `lib/scan-store.ts`

```ts
export async function recordOutcome(
  id: string,
  action: OutcomeAction,
): Promise<{ conflict: boolean; stored: StoredScan | null }> {
  if (!UUID_RE.test(id)) throw new Error('Invalid scan ID format');

  const scan = await getScanById(id);
  if (!scan) return { conflict: false, stored: null };
  if (scan.outcome) return { conflict: true, stored: scan };

  const updated: StoredScan = { ...scan, outcome: action, outcomeAt: Date.now() };
  scans.set(id, updated);

  // Best-effort disk write — outcome loss on restart is acceptable for Phase 2
  writeFile(scanFilePath(id), JSON.stringify(updated), 'utf8').catch((err) => {
    log.warn('Failed to persist outcome to disk', { id, err: (err as Error).message });
  });

  return { conflict: false, stored: updated };
}
```

---

### Step 2.4 — Create the outcome endpoint
**File:** `app/api/scan/[id]/outcome/route.ts` (new file)

```ts
import { recordOutcome } from '@/lib/scan-store';
import { checkRateLimit } from '@/lib/rate-limit';  // extract from route.ts — see Step 2.5
import type { OutcomeAction } from '@/types/garment';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ACTIONS = new Set<OutcomeAction>(['throw_away', 'repair', 'list', 'donate']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  const ip =
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    'unknown';

  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('action' in body)) {
    return Response.json({ error: 'Missing required field: action.' }, { status: 400 });
  }

  const action = (body as Record<string, unknown>).action;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action as OutcomeAction)) {
    return Response.json(
      { error: 'action must be one of: throw_away, repair, list, donate.' },
      { status: 400 },
    );
  }

  const { conflict, stored } = await recordOutcome(id, action as OutcomeAction);

  if (!stored) {
    return Response.json({ error: 'Scan not found.' }, { status: 404 });
  }
  if (conflict) {
    return Response.json({ error: 'Outcome already recorded for this scan.' }, { status: 409 });
  }

  return Response.json({ id, outcome: stored.outcome }, { status: 200 });
}
```

**Security rules enforced:**
- `action` validated against `VALID_ACTIONS` set — any other string → 400
- One outcome per scan — second write → 409 (prevents double environmental credit)
- IP rate limiting via shared `checkRateLimit`
- Response contains only `{ id, outcome }` — scan data never exposed

---

### Step 2.5 — Extract `checkRateLimit` into a shared module
**File:** `lib/rate-limit.ts` (new file)

Move the `checkRateLimit` function and `ipHits` Map out of `app/api/scan/route.ts` so the outcome endpoint can import it without creating a second independent rate limiter. Both endpoints will share the same Map instance.

Export: `checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number }`

Update `app/api/scan/route.ts` to import from `@/lib/rate-limit`.

---

## Phase 3 — Account System + Leaderboard

**Requires new persistent infrastructure. Cannot ship without a database decision.**

### Step 3.1 — Choose and provision the database

**Recommended: Firebase/Firestore**

Rationale for this codebase:
- Already in the Google Cloud ecosystem alongside Vision, Gemini, BigQuery, and Places
- Free tier covers this use case (1 GB storage, 50K reads/day, 20K writes/day)
- Firebase Auth handles Google OAuth — consistent with the existing Google service account pattern
- Serverless-native — no connection pooling required on Vercel
- Real-time leaderboard via `onSnapshot` is available if the frontend wants live updates

Alternative: **Neon** (serverless Postgres) — better if complex SQL queries are anticipated; worse for real-time.

**Setup steps:**
1. Create a Firebase project at console.firebase.google.com
2. Enable Firestore in Native mode
3. Enable Firebase Authentication with Google provider
4. Generate a service account key for `firebase-admin`
5. Add to `.env.local`: `FIREBASE_SERVICE_ACCOUNT_JSON=<base64-encoded JSON>`

---

### Step 3.2 — Define the Firestore schema

```
/users/{userId}
  email: string
  displayName: string
  avatarUrl?: string
  totalCO2SavedKg: number       // incremented atomically on each non-throw_away outcome
  totalWaterSavedLiters: number // incremented atomically on each non-throw_away outcome
  actionCount: number           // total logged outcomes
  joinedAt: Timestamp

/outcomes/{outcomeId}
  userId: string
  scanId: string
  action: 'repair' | 'list' | 'donate' | 'throw_away'
  co2Kg: number                 // snapshot of scan.cost.co2_kg at time of outcome
  waterLiters: number           // snapshot of scan.cost.water_liters
  createdAt: Timestamp
```

**Design decisions:**
- User totals are denormalized onto the `/users` document — leaderboard reads are O(1) per user, not an aggregation query
- `co2Kg` and `waterLiters` are snapshots — they don't change if the scan expires
- `throw_away` outcomes are stored but do NOT increment user totals (no credit for discarding)

---

### Step 3.3 — Initialize `firebase-admin`
**File:** `lib/firebase/admin.ts` (new file)

```ts
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_JSON');

  let credentials: object;
  try {
    credentials = JSON.parse(
      Buffer.from(raw, 'base64').toString('utf8'),
    );
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON.');
  }

  return initializeApp({ credential: cert(credentials as Parameters<typeof cert>[0]) });
}

export const adminAuth = () => getAuth(getAdminApp());
export const db = () => getFirestore(getAdminApp());
```

**Notes:**
- `getApps().length > 0` guard prevents re-initialization on hot reloads
- Credentials decoded from base64 — same pattern as the existing `getGoogleCredentialsFromBase64` in `lib/google/client.ts`
- `adminAuth()` and `db()` are functions (not module-level constants) to defer initialization until first call — avoids cold-start errors when env vars are missing

---

### Step 3.4 — Add JWT verification middleware
**File:** `lib/firebase/verify-token.ts` (new file)

```ts
import { adminAuth } from '@/lib/firebase/admin';

export type VerifiedUser = {
  uid: string;
  email: string | undefined;
};

export async function verifyBearerToken(
  request: Request,
): Promise<VerifiedUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    return null;
  }
}
```

**Rules:**
- Returns `null` on any verification failure — callers decide whether to reject or allow anonymous
- Never logs the token value
- `uid` comes from the verified token — never from the request body

---

### Step 3.5 — Create `POST /api/auth/callback`
**File:** `app/api/auth/callback/route.ts` (new file)

Receives the Firebase ID token from the client after Google sign-in. Verifies it server-side and upserts the user document in Firestore. Returns the verified user profile.

```ts
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(request: Request) {
  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Invalid or expired token.' }, { status: 401 });
  }

  const userRef = db().collection('users').doc(user.uid);
  await userRef.set(
    {
      email: user.email ?? '',
      // displayName sourced from token claim if available
      joinedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },  // merge: true — only sets missing fields, never overwrites totals
  );

  const snapshot = await userRef.get();
  const data = snapshot.data()!;

  return Response.json({
    uid: user.uid,
    displayName: data.displayName ?? null,
    totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
    totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
    actionCount: data.actionCount ?? 0,
  });
}
```

---

### Step 3.6 — Create `GET /api/user/me`
**File:** `app/api/user/me/route.ts` (new file)

Returns the authenticated user's profile and environmental totals.

```ts
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';

export async function GET(request: Request) {
  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const snapshot = await db().collection('users').doc(user.uid).get();
  if (!snapshot.exists) {
    return Response.json({ error: 'User not found.' }, { status: 404 });
  }

  const data = snapshot.data()!;
  return Response.json({
    uid: user.uid,
    displayName: data.displayName ?? null,
    avatarUrl: data.avatarUrl ?? null,
    totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
    totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
    actionCount: data.actionCount ?? 0,
    joinedAt: data.joinedAt?.toMillis() ?? null,
  });
}
```

**Security:** Email is never included in the response — uid and public profile fields only.

---

### Step 3.7 — Create `GET /api/leaderboard`
**File:** `app/api/leaderboard/route.ts` (new file)

```ts
import { db } from '@/lib/firebase/admin';

export async function GET() {
  const snapshot = await db()
    .collection('users')
    .orderBy('totalCO2SavedKg', 'desc')
    .limit(10)
    .get();

  const entries = snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      // Never expose uid or email in leaderboard
      displayName: data.displayName ?? 'Anonymous',
      totalCO2SavedKg: data.totalCO2SavedKg ?? 0,
      totalWaterSavedLiters: data.totalWaterSavedLiters ?? 0,
      actionCount: data.actionCount ?? 0,
    };
  });

  return Response.json(
    { leaderboard: entries },
    { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
  );
}
```

**Privacy:** `uid` and `email` are never included. Display name only. The 60s cache avoids a Firestore read on every page load.

---

### Step 3.8 — Connect outcome endpoint to user totals
**File:** `app/api/scan/[id]/outcome/route.ts`

Extend the `POST` handler to optionally credit the authenticated user:

After `recordOutcome` succeeds, check for a valid Bearer token:
```ts
const user = await verifyBearerToken(request);

if (user && action !== 'throw_away') {
  const scan = stored;  // already have the StoredScan from recordOutcome
  const co2Kg = scan.result.cost.co2_kg;
  const waterLiters = scan.result.cost.water_liters;

  const outcomeDocRef = db().collection('outcomes').doc();
  const userRef = db().collection('users').doc(user.uid);

  // Atomic batch — both writes succeed or both fail
  const batch = db().batch();
  batch.set(outcomeDocRef, {
    userId: user.uid,
    scanId: id,
    action,
    co2Kg,
    waterLiters,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(userRef, {
    totalCO2SavedKg: FieldValue.increment(co2Kg),
    totalWaterSavedLiters: FieldValue.increment(waterLiters),
    actionCount: FieldValue.increment(1),
  });

  await batch.commit();
}
```

**Concurrency safety:** `FieldValue.increment()` is an atomic Firestore server-side operation — it never races with concurrent outcome submissions from the same user.

---

## API Contract Summary

| Endpoint | Method | Auth | Request | Response |
|---|---|---|---|---|
| `/api/scan` | POST | — | `multipart/form-data` | `{ id, text, result }` |
| `/api/scan/:id` | GET | — | — | `{ id, text, result, createdAt }` |
| `/api/scan/:id/outcome` | POST | Optional | `{ action }` | `{ id, outcome }` |
| `/api/auth/callback` | POST | Firebase token | — | `{ uid, displayName, totals }` |
| `/api/user/me` | GET | Required | — | `{ uid, displayName, totals }` |
| `/api/leaderboard` | GET | Optional | — | `{ leaderboard: [...] }` |
| `/api/health` | GET | — | — | `{ status, ts, version }` |

---

## Implementation Order

```
Week 0   Steps 0.1 – 0.7   Fix all MAJOR issues (no new features on broken foundation)
Week 1   Steps 1.1 – 1.6   Condition + disposal (gemini.ts, types/garment.ts, route.ts)
Week 2   Steps 2.1 – 2.5   Outcome endpoint (scan-store.ts, new endpoint, extract rate-limit)
Week 3   Steps 3.1 – 3.4   Firestore setup, firebase-admin init, JWT middleware
Week 4   Steps 3.5 – 3.8   Auth callback, /user/me, /leaderboard, connect outcomes to totals
```

Each week produces a shippable, mergeable PR. No week depends on the next being complete except Week 4 depending on Week 3.
